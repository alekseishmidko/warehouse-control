/** @file Строгий разбор локального CLI и проверка явного разрешения до создания пула БД.
 * Проверка роли БД выполняется отдельно сервисом; полноценную авторизацию пользователя файл не реализует. */
import type { RuntimeConfig } from '../config/environment';
import { isUuid } from '../../shared/validation/identifiers';
import { PUTAWAY_DESTINATION } from './outbox-destinations';
import { RecoveryError, RetryDeliveryDto, DeliveryAddress, BacklogThresholds } from './dto/recovery.dto';
/** Результат разбора одной из трёх команд. Массового повтора, вывода исходного payload
 * и сброса маркеров/курсоров нет; union определяет допустимые параметры каждой ветки. */
export type RecoveryOptions = { command: 'inspect'; address: DeliveryAddress; payload: boolean }
  | { command: 'retry'; input: RetryDeliveryDto } | { command: 'signal'; thresholds: BacklogThresholds };
/** Проверяет недоверенный адрес до обращения к БД и возвращает новый объект.
 * UUID нормализуется в нижний регистр, consumer сверяется с серверным реестром.
 * @throws RecoveryError С кодом INVALID_ARGUMENTS при неправильном UUID или получателе. */
export function validateAddress(input: DeliveryAddress): DeliveryAddress {
  if (!isUuid(input.eventId) || input.consumer !== PUTAWAY_DESTINATION) throw new RecoveryError('INVALID_ARGUMENTS');
  return { eventId: input.eventId.toLowerCase(), consumer: input.consumer };
}
/** Проверяет команду и при прямом вызове сервиса, а не только через CLI.
 * Причина ограничена техническим slug; идентификаторы нормализуются, лишний текст в ошибку не включается.
 * @throws RecoveryError С кодом INVALID_ARGUMENTS; входные значения не отражаются в сообщении. */
export function validateRetry(input: RetryDeliveryDto): RetryDeliveryDto {
  const address = validateAddress(input);
  if (!isUuid(input.operatorId) || !isUuid(input.correlationId) || typeof input.reasonCode !== 'string'
    || !/^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/.test(input.reasonCode) || input.reasonCode.length > 96) throw new RecoveryError('INVALID_ARGUMENTS');
  return { ...address, operatorId: input.operatorId.toLowerCase(), correlationId: input.correlationId.toLowerCase(), reasonCode: input.reasonCode };
}
/** Проверяет явный NODE_ENV dev/test, OUTBOX_ADMIN_ENABLED=true и loopback hostname БД.
 * @param config Уже проверенная конфигурация соединения, содержащая чувствительный URL.
 * @param env Исходная среда: значение NODE_ENV по умолчанию не считается разрешением.
 * @throws RecoveryError С кодом LOCAL_ACCESS_REQUIRED до создания Nest/пула.
 * Проверка hostname не обнаруживает туннели и не подтверждает личность оператора. */
export function requireLocalRecovery(config: RuntimeConfig, env: NodeJS.ProcessEnv): void {
  const host = new URL(config.databaseUrl).hostname;
  if (!['development', 'test'].includes(env.NODE_ENV ?? '') || env.OUTBOX_ADMIN_ENABLED !== 'true'
    || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) throw new RecoveryError('LOCAL_ACCESS_REQUIRED');
}
/** Проверяет три целочисленных порога и возвращает отдельный объект без дополнительных полей.
 * @throws RecoveryError С кодом INVALID_ARGUMENTS при лишнем поле или значении вне 1..1000000. */
export function validateThresholds(input: BacklogThresholds): BacklogThresholds {
  if (Object.values(input).length !== 3 || ![input.deadLimit, input.backlogLimit, input.maxAgeSeconds]
    .every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1000000)) throw new RecoveryError('INVALID_ARGUMENTS');
  return { deadLimit: input.deadLimit, backlogLimit: input.backlogLimit, maxAgeSeconds: input.maxAgeSeconds };
}
/** Разбирает недоверенные именованные флаги без чтения файлов, окружения и запуска Nest.
 * @param args Аргументы после имени executable; повторяющиеся и неизвестные флаги запрещены.
 * @param correlationId Новый UUID административного вызова, созданный CLI на серверной стороне.
 * @returns Проверенную команду; только --payload не требует значения.
 * @throws RecoveryError С кодом INVALID_ARGUMENTS, без включения полученных аргументов. */
export function parseRecoveryOptions(args: string[], correlationId: string): RecoveryOptions {
  const [command, ...rest] = args; const flags = new Map<string, string | boolean>();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]; if (!key.startsWith('--') || flags.has(key)) throw new RecoveryError('INVALID_ARGUMENTS');
    if (key === '--payload') flags.set(key, true);
    else { const value = rest[++i]; if (!value || value.startsWith('--')) throw new RecoveryError('INVALID_ARGUMENTS'); flags.set(key, value); }
  }
  const allowed = command === 'inspect' ? ['--event', '--consumer', '--payload'] : command === 'retry'
    ? ['--event', '--consumer', '--operator', '--reason'] : command === 'signal' ? ['--dead-limit', '--backlog-limit', '--max-age-seconds'] : [];
  if (!['inspect', 'retry', 'signal'].includes(command) || [...flags.keys()].some(key => !allowed.includes(key))) throw new RecoveryError('INVALID_ARGUMENTS');
  // Пороги читаем как десятичные целые: Number сам по себе разрешил бы дробь или экспоненту.
  if (command === 'signal') {
    /** Читает один числовой флаг или его серверное значение по умолчанию; некорректный формат отклоняется. */
    const integer = (key: string, fallback: number) => { const raw = flags.get(key) ?? String(fallback);
      if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new RecoveryError('INVALID_ARGUMENTS'); return Number(raw); };
    return { command, thresholds: validateThresholds({ deadLimit: integer('--dead-limit', 1), backlogLimit: integer('--backlog-limit', 100), maxAgeSeconds: integer('--max-age-seconds', 60) }) };
  }
  const address = { eventId: flags.get('--event') as string, consumer: flags.get('--consumer') as string };
  if (command === 'inspect') return { command, address: validateAddress(address), payload: flags.has('--payload') };
  return { command: 'retry', input: validateRetry({ ...address, operatorId: flags.get('--operator') as string, reasonCode: flags.get('--reason') as string, correlationId }) };
}
