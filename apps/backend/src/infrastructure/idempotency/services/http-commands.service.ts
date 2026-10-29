/** @file Владелец command transaction: dedup claim, бизнес-callback и success result атомарны. */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../shared/serialization/canonical-json';
import { CommandError } from '../../../shared/errors/command-error';
import { requireUuid } from '../../../shared/validation/identifiers';
import type { CommandScope, CommandResult } from '../../../shared/operations/dto/command-scope.dto';
import {
  TRANSACTION_RUNNER,
  TransactionRunner,
  TransactionContext,
} from '../../../shared/transactions/transaction.port';
import { IdempotencyRepository } from '../repositories/idempotency.repository';
/** Публичный service для HTTP controllers; бизнес-модули вызываются callback с тем же context. */
@Injectable()
export class HttpCommandsService {
  /** Получает общий runner и внутренний SQL adapter; конструктор не открывает соединение/транзакцию. */
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transactions: TransactionRunner,
    private readonly repository: IdempotencyRepository,
  ) {}
  /**
   * Выполняет новую команду либо возвращает результат ранее зафиксированной попытки.
   *
   * @param scope Доверенные actor/operation, validated UUID key и correlationId текущего запроса.
   * @param normalizedRequest Plain JSON с нормализованными target/path params и body, без correlation headers.
   * @param authorize Повторная проверка session/permission в том же context до claim и replay; без внешнего I/O.
   * @param work Бизнес-callback с общим context; только awaited DB-эффекты, без I/O и вложенного run.
   * @returns Копия успешного status/body/Location после commit; replay возвращает исходный бизнес-результат.
   * @throws CommandError при неверном normalized JSON/scope или другом hash того же ключа.
   * @throws Error при нарушении storage/result контракта; SQL и callback errors также выходят до runner.
   *
   * Guard проверяет сессию до execute; authorize обязан повторить актуальную policy
   * в общем context до claim/replay, поскольку work при replay не вызывается.
   * Ошибки не кешируются; rollback отменяет claim/result и все бизнес-записи callback.
   * Потеря HTTP-ответа не отменяет commit: повторять исходный key, а не создавать новый.
   */
  async execute(
    scope: CommandScope,
    normalizedRequest: unknown,
    work: (context: TransactionContext) => Promise<CommandResult>,
    authorize?: (context: TransactionContext) => Promise<void>,
  ): Promise<CommandResult> {
    requireUuid(scope.actorId, 'actorId');
    requireUuid(scope.key, 'idempotencyKey');
    requireUuid(scope.correlationId, 'correlationId');
    if (
      !['user', 'system'].includes(scope.actorType) ||
      !/^[a-z][a-z0-9.-]{0,95}$/.test(scope.operation)
    )
      throw new CommandError('VALIDATION_FAILED');
    // Scope и request фиксируются до первого await: caller не может изменить hash/key пока ждёт pool.
    scope = Object.freeze({
      ...scope,
      actorId: scope.actorId.toLowerCase(),
      key: scope.key.toLowerCase(),
    });
    const hash = createHash('sha256').update(canonicalJson(normalizedRequest)).digest('hex');
    // Единственная транзакция охватывает и unique claim, и callback, и response snapshot.
    // Возвращённое значение будет доступно caller только после успешного COMMIT runner.
    return this.transactions.run(async (context) => {
      // Permission/session locks удерживаются до результата, поэтому отзыв не обходит saved replay.
      // Callback обязателен для production warehouse controllers; test-only protocol fixture может его не задавать.
      await authorize?.(context);
      // Unique INSERT ждёт владельца scope. false означает, что тот успел закоммитить
      // строку; после его rollback INSERT мог бы выполниться и вернуть true.
      if (!(await this.repository.claim(context, scope, hash))) {
        // Нужен отдельный statement: read committed snapshot ожидавшего INSERT мог
        // ещё не видеть winner. Нельзя заменить этот read на SELECT того же statement.
        const previous = await this.repository.find(context, scope);
        // Committed pending нарушает протокол: повторно запускать work опасно,
        // поскольку состояние уже не доказывает отсутствие предыдущего эффекта.
        if (!previous || previous.statusCode === null || previous.completedAt === null)
          throw new Error('Invalid committed idempotency state');
        if (previous.requestHash !== hash) throw new CommandError('IDEMPOTENCY_CONFLICT');
        return {
          statusCode: previous.statusCode as CommandResult['statusCode'],
          body: previous.body,
          headers: previous.headers ?? {},
        };
      }
      // Результат копируется до записи; будущие мутации исходного body не меняют сохранённый response.
      const candidate = await work(context);
      let result: CommandResult;
      // Canonical serializer отклоняет non-JSON/нестабильные значения и делает копию.
      // Неверный ответ сформировал сервер, поэтому его ошибка не должна стать HTTP 400 клиента.
      try {
        result = JSON.parse(canonicalJson(candidate)) as CommandResult;
      } catch {
        throw new Error('Invalid command result');
      }
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new Error('Invalid command result');
      if (
        ![200, 201, 202].includes(result.statusCode) ||
        !Object.hasOwn(result, 'body') ||
        Object.keys(result).some((key) => !['statusCode', 'body', 'headers'].includes(key))
      )
        throw new Error('Invalid command result');
      // Сохраняем только относительный Location: replay не должен повторять cookies,
      // credentials или произвольные transport headers предыдущего HTTP запроса.
      if (
        result.headers !== undefined &&
        (!result.headers ||
          typeof result.headers !== 'object' ||
          Array.isArray(result.headers) ||
          Object.keys(result.headers).some((key) => key !== 'location') ||
          (result.headers.location !== undefined &&
            !/^\/api\/v1\/[A-Za-z0-9/._~-]{1,480}$/.test(result.headers.location)))
      )
        throw new Error('Invalid command headers');
      const snapshot = { ...result, headers: result.headers ?? {} };
      // Это UPDATE в ещё открытой транзакции, не самостоятельное подтверждение команды.
      // Текущий X-Correlation-Id добавит HTTP adapter, он не часть сохранённого response.
      await this.repository.complete(context, scope, snapshot);
      return snapshot;
    });
  }
}
