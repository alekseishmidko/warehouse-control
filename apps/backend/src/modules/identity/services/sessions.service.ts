/**
 * @file Создание, проверка, продление и отзыв серверных сессий.
 * Репозиторий хранит хеш токена и сроки. Сервис проверяет пользователя и выбирает блокировки.
 * HTTP-cookie обрабатывает контроллер, складские права проверяет AccessService.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../../shared/transactions/transaction.port';
import { CommandError } from '../../../shared/errors/command-error';
import { IdentityRepository } from '../repositories/identity.repository';
import { IdentityTransactionsService } from './identity-transactions.service';
import { randomUUID } from 'node:crypto';
import { isSecret, newSecret, secretHash, sessionCsrf } from '../../../shared/security/secrets';
import { IDENTITY_CONFIG, IdentityConfig } from '../identity.config';
import { Principal } from '../dto/principal.dto';
import type { UserProfileDto } from '../dto/user-profile.dto';
import { toUserProfile } from './user-profile';
/**
 * Пользователь блокируется раньше сессии: все сценарии должны соблюдать этот порядок.
 * Методы с переданным context работают в транзакции вызывающего сервиса.
 * authenticate и logout открывают собственную транзакцию через IdentityTransactionsService.
 */
@Injectable()
export class SessionsService {
  /** Получает проверенные настройки сроков; те же настройки определяют срок cookie в HTTP-слое. */
  constructor(
    private readonly transactions: IdentityTransactionsService,
    private readonly repository: IdentityRepository,
    @Inject(IDENTITY_CONFIG) readonly config: IdentityConfig,
  ) {}
  /**
   * Создаёт сессию после проверки пароля и повторного чтения пользователя в AuthService.
   * @param context Транзакция входа, которая уже удерживает блокировку активного пользователя.
   * @param userId Проверенный сервером субъект, не значение из HTTP body.
   * @returns Исходный токен для cookie и связанный с ним CSRF-токен для защиты изменяющих запросов.
   * @throws Ошибка INSERT передаётся владельцу транзакции. Контроллер выдаёт cookie только после commit.
   */
  async create(context: TransactionContext, userId: string) {
    // Секрет генерируется заново для каждого входа. Знание userId не позволяет вычислить токен.
    const token = newSecret();
    // UUID строки нужен для адресного отзыва и не является секретом входа.
    // В БД передаём только SHA-256 случайного токена. Такой быстрый хеш подходит для
    // высокоэнтропийного секрета; пароль пользователя требует отдельного медленного хеширования.
    await this.repository.createSession(
      context,
      randomUUID(),
      userId,
      secretHash(token),
      this.config.absoluteSeconds,
      this.config.idleSeconds,
    );
    // CSRF вычисляется из того же токена: значение другой сессии не подойдёт.
    // Исходный токен нужен HTTP-слою для HttpOnly-cookie; его нельзя включать в JSON-ответ или журнал.
    return { token, csrfToken: sessionCsrf(token) };
  }
  /**
   * Проверяет токен из cookie и продлевает срок бездействия действующей сессии.
   * @param token Недоверенное значение из HTTP-запроса. Проверка формата ещё не подтверждает вход.
   * @returns Неизменяемый Principal с ID пользователя и сессии после успешного commit.
   * @throws UNAUTHORIZED для неверного токена, неактивного пользователя или недействующей сессии.
   * Ошибка БД откатывает продление срока; новый Principal вызывающему не возвращается.
   */
  async authenticate(token: unknown): Promise<Principal> {
    // unknown заставляет проверить тип и формат до хеширования и обращения к БД.
    if (!isSecret(token)) throw new CommandError('UNAUTHORIZED');
    return this.transactions.run(async (context) => {
      // Первичный поиск даёт только ID. Он не блокирует строку и не доказывает, что сессия
      // ещё действует: пользователь мог быть заблокирован, а сессия — отозвана сразу после поиска.
      const found = await this.repository.findSessionByTokenHash(context, secretHash(token));
      if (!found) throw new CommandError('UNAUTHORIZED');
      // Личность берём из записи БД, а не из заголовков или тела запроса.
      const principal = { userId: found.user_id, sessionId: found.id };
      // Под блокировками повторно проверяем состояние и продлеваем только idle-срок.
      // Абсолютный срок входа остаётся верхней границей; новый вход здесь не создаётся.
      await this.requireSession(context, principal, {
        refreshIdleSeconds: this.config.idleSeconds,
      });
      // readonly в Principal защищает только при проверке TypeScript. Object.freeze запрещает
      // менять, добавлять и удалять поля этого объекта также во время выполнения JavaScript.
      // Поэтому следующий обработчик не сможет случайно заменить проверенные userId/sessionId.
      // Заморозка поверхностная: здесь её достаточно, поскольку оба поля — строки, без вложенных объектов.
      // Она не проверяет права и не заменяет блокировки БД. Права повторно проверяются в сценарии команды.
      // Внешний Promise run завершится лишь после commit, хотя объект создаётся внутри callback.
      return Object.freeze(principal);
    });
  }
  /**
   * Проверяет активность пользователя и сессии в заимствованной транзакции.
   * @param context Действующая транзакция вызывающего; второй run здесь запрещён.
   * @param principal Серверные ID после проверки токена; актуальное состояние перечитывается из БД.
   * @param options Режим блокировки и число секунд продления из проверенных настроек сервера.
   * Для logout нужен sessionLock=update без продления. При refreshIdleSeconds UPDATE выбирается автоматически.
   * @returns Безопасный профиль; блокировки остаются до commit/rollback вызывающего.
   * @throws UNAUTHORIZED при блокировке пользователя, истечении или отзыве сессии.
   * SQL-ошибка передаётся владельцу транзакции, который откатывает сценарий.
   */
  async requireSession(
    context: TransactionContext,
    principal: Principal,
    options: { sessionLock?: 'share' | 'update'; refreshIdleSeconds?: number } = {},
  ): Promise<UserProfileDto> {
    // SHARE удерживает активность и права пользователя до завершения транзакции.
    // Собственная административная операция заранее берёт более сильный UPDATE в UsersService;
    // повторное чтение здесь не снимает эту блокировку. Порядок описан в docs/flows/identity.md.
    const user = await this.repository.lockAndFindUser(context, principal.userId);
    // Короткое замыкание || не даёт обращаться к user.id при отсутствии пользователя.
    // Одинаковый UNAUTHORIZED не раскрывает клиенту, какая именно проверка сессии отказала.
    if (
      !user?.active ||
      !(
        await this.repository.lockSessionAndReadValidity(
          context,
          principal.sessionId,
          user.id,
          // Продление изменяет строку, поэтому требует UPDATE независимо от sessionLock.
          // Без продления достаточно SHARE, кроме явного UPDATE для последующего отзыва.
          // Репозиторий сверяет сроки с часами БД новым SQL уже после ожидания блокировки.
          options.refreshIdleSeconds !== undefined ? 'update' : (options.sessionLock ?? 'share'),
        )
      )?.valid
    )
      throw new CommandError('UNAUTHORIZED');
    // Проверка и продление используют один context. При продлении уже удерживается UPDATE:
    // другой запрос не может отозвать сессию между проверкой valid и изменением срока.
    // undefined означает «не продлевать», а не срок по умолчанию.
    if (options.refreshIdleSeconds !== undefined)
      await this.repository.refreshSessionIdleDeadline(
        context,
        principal.sessionId,
        options.refreshIdleSeconds,
      );
    // Явная проекция исключает password_hash и другие внутренние поля записи пользователя.
    return toUserProfile(user);
  }
  /**
   * Отзывает текущую сессию в отдельной транзакции. Контроллер очищает cookie после commit.
   * @param principal Серверные ID после HTTP-проверки; она могла завершиться до чужого отзыва.
   * @throws UNAUTHORIZED, если повторная проверка обнаружила недействующую сессию.
   * SQL-ошибка откатывает отзыв. Данные входа не попадают в хранилище идемпотентных бизнес-команд.
   */
  async logout(principal: Principal): Promise<void> {
    await this.transactions.run(async (context) => {
      // Два запроса с SHARE могли бы ждать повышения блокировки друг друга до UPDATE.
      // Сразу берём UPDATE: второй logout ждёт первый, затем видит отзыв и получает UNAUTHORIZED.
      // refreshIdleSeconds отсутствует: logout не продлевает срок. Пользователь блокируется первым.
      await this.requireSession(context, principal, { sessionLock: 'update' });
      // Await включает запись отзыва в эту же транзакцию. При ошибке не сообщаем об успешном выходе.
      await this.revoke(context, principal.userId, principal.sessionId);
    });
  }
  /**
   * Отзывает одну или все сессии в транзакции вызывающего сервиса.
   * Вызывающий предварительно проверяет право на отзыв и удерживает нужные блокировки.
   * UsersService добавляет административный аудит в ту же транзакцию.
   * @param userId Проверенный ID целевого пользователя; метод сам не проверяет право администратора.
   * @param sessionId ID одной сессии. Если отсутствует, отзываются все сессии пользователя.
   * @throws Ошибка SQL передаётся владельцу транзакции. Отдельного run или commit здесь нет.
   */
  async revoke(context: TransactionContext, userId: string, sessionId?: string): Promise<void> {
    // Запись не удаляется: репозиторий сохраняет дату отзыва и не меняет её при повторе.
    // Повторная запись отзыва безопасна. Однако logout сначала требует действующую сессию,
    // поэтому повторный logout уже отозванной сессии возвращает UNAUTHORIZED.
    await this.repository.revoke(context, userId, sessionId);
  }
}
