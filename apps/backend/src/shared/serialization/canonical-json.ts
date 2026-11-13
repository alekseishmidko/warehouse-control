/** @file Детерминированный JSON для fingerprint и snapshot: порядок object keys не влияет на hash, порядок arrays сохраняется. */
import { CommandError } from '../errors/command-error';
/** Верхняя граница UTF-8 request JSON, включая кавычки, escape sequences и разделители. */
const MAX_REQUEST_BYTES = 256 * 1024;
/** Корневое значение имеет depth=0; значение на глубине 64 ещё допустимо. */
const MAX_JSON_DEPTH = 64;
/**
 * Сериализует plain JSON без преобразования типов, toJSON и удаления undefined.
 * Принимает конечные числа; отклоняет циклы, host objects и глубину >64.
 * DTO-владелец предварительно нормализует поля и собирает plain request.
 * Input не меняется; I/O, авторизация и бизнес-нормализация здесь не выполняются.
 *
 * @param input Нормализованный JSON request, не DTO instance или ORM entity.
 * @returns JSON со стабильным порядком object keys, подходящий для SHA-256 и независимого snapshot.
 * @throws CommandError VALIDATION_FAILED для недопустимого значения/depth, REQUEST_TOO_LARGE для UTF-8 >256 КиБ.
 * Семантически разные строки/порядок массива не объединяет; это не бизнес-нормализатор.
 */
export function canonicalJson(input: unknown): string {
  return encodeCanonicalJson(input, MAX_REQUEST_BYTES);
}
/** Снимок server-owned результата: те же JSON/depth/getter проверки без лимита request body.
 * История результата может быть больше входной команды. Размер ответа нельзя уменьшать
 * скрытым удалением allocations; ограничения чтения истории задаёт отдельный API contract.
 * Не применять к недоверенному request: для fingerprint используется canonicalJson.
 * @param input Plain JSON результата, сформированный сервером, без DTO/ORM instances.
 * @returns Полный детерминированный JSON; копию caller получает через JSON.parse.
 * @throws CommandError VALIDATION_FAILED для non-JSON, циклов, getters и depth>64.
 * Функция не сохраняет результат и не подтверждает commit транзакции.
 */
export function canonicalSnapshotJson(input: unknown): string {
  return encodeCanonicalJson(input);
}
/** Общий encoder с необязательным бюджетом request. Snapshot использует те же JSON guards.
 * Бюджет останавливает обход до разворачивания всего DAG; это не лимит памяти уже
 * созданного input или отдельной строки, которую JSON.stringify кодирует целиком.
 */
function encodeCanonicalJson(input: unknown, maxBytes?: number): string {
  const parts: string[] = [];
  let bytes = 0;
  /** Учитывает каждый фрагмент ровно один раз, включая JSON punctuation и escaping.
   * Проверка до push исключает накопление результата сверх request budget.
   */
  const append = (part: string): void => {
    if (maxBytes !== undefined) {
      bytes += Buffer.byteLength(part, 'utf8');
      if (bytes > maxBytes) throw new CommandError('REQUEST_TOO_LARGE');
    }
    parts.push(part);
  };
  // Храним только текущую ветку, а не все посещённые объекты: повторная ссылка
  // на один объект в соседних полях допустима, ссылка на предка означает цикл.
  const ancestors = new Set<object>();
  /** Рекурсивно кодирует один JSON value; depth ограничивает глубину вложения до обхода детей. */
  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_JSON_DEPTH) throw new CommandError('VALIDATION_FAILED');
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      append(JSON.stringify(value));
      return;
    }
    if (typeof value !== 'object' || value === null || ancestors.has(value))
      throw new CommandError('VALIDATION_FAILED');
    // Date/class instances могли бы менять wire data через toJSON. Принимаем только
    // plain records (включая Object.create(null)), их данные выбирает сам обход.
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new CommandError('VALIDATION_FAILED');
    }
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        append('[');
        // Посещаем и holes, чтобы они не превратились незаметно в null. Цикл
        // не создаёт Array длиной value.length до проверки каждого элемента.
        for (let index = 0; index < value.length; index++) {
          if (index > 0) append(',');
          const property = Object.getOwnPropertyDescriptor(value, String(index));
          if (!property || !('value' in property)) throw new CommandError('VALIDATION_FAILED');
          visit(property.value, depth + 1);
        }
        append(']');
        return;
      }
      // Сортировка делает hash независимым от порядка вставки полей. Array order выше сохранён.
      append('{');
      const keys = Object.keys(value).sort();
      for (const [index, key] of keys.entries()) {
        if (index > 0) append(',');
        const property = Object.getOwnPropertyDescriptor(value, key)!;
        // Getter не выполняется: hashing не должен иметь пользовательских эффектов.
        if (!('value' in property)) throw new CommandError('VALIDATION_FAILED');
        append(JSON.stringify(key));
        append(':');
        visit(property.value, depth + 1);
      }
      append('}');
    } finally {
      ancestors.delete(value);
    }
  };
  visit(input, 0);
  return parts.join('');
}
