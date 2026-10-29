/** @file Детерминированный JSON для fingerprint и snapshot: порядок object keys не влияет на hash, порядок arrays сохраняется. */
import { CommandError } from '../errors/command-error';
/**
 * Сериализует только plain JSON без toJSON/coercion, finite numbers и скрытого удаления undefined.
 * Rejects циклы/host objects и глубину >64; не меняет input, не выполняет I/O.
 * DTO-владелец предварительно явно нормализует поля и собирает plain request/response.
 *
 * @param input Нормализованный JSON request либо response, не DTO instance или ORM entity.
 * @returns JSON со стабильным порядком object keys, подходящий для SHA-256 и независимого snapshot.
 * @throws CommandError VALIDATION_FAILED для недопустимого значения/depth, REQUEST_TOO_LARGE для UTF-8 >256 КиБ.
 * Семантически разные строки/порядок массива не объединяет; это не бизнес-нормализатор.
 */
export function canonicalJson(input: unknown): string {
  // Храним только текущую ветку, а не все посещённые объекты: повторная ссылка
  // на один объект в соседних полях допустима, ссылка на предка означает цикл.
  const ancestors = new Set<object>();
  /** Рекурсивно кодирует один JSON value; depth ограничивает глубину вложения до обхода детей. */
  const visit = (value: unknown, depth: number): string => {
    if (depth > 64) throw new CommandError('VALIDATION_FAILED');
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
      return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
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
        // Array.from посещает и holes, чтобы они не превратились незаметно в null.
        return `[${Array.from({ length: value.length }, (_, index) => {
          const property = Object.getOwnPropertyDescriptor(value, String(index));
          if (!property || !('value' in property)) throw new CommandError('VALIDATION_FAILED');
          return visit(property.value, depth + 1);
        }).join(',')}]`;
      }
      // Сортировка делает hash независимым от порядка вставки полей. Array order выше сохранён.
      return `{${Object.keys(value)
        .sort()
        .map((key) => {
          const property = Object.getOwnPropertyDescriptor(value, key)!;
          // Getter не выполняется: hashing не должен иметь пользовательских эффектов.
          if (!('value' in property)) throw new CommandError('VALIDATION_FAILED');
          return `${JSON.stringify(key)}:${visit(property.value, depth + 1)}`;
        })
        .join(',')}}`;
    } finally {
      ancestors.delete(value);
    }
  };
  const result = visit(input, 0);
  // Размер считается после сериализации, включая escape sequences и UTF-8, не по string.length.
  // Это лимит результата, а не защита от памяти уже созданного огромного объекта caller.
  if (Buffer.byteLength(result, 'utf8') > 256 * 1024) throw new CommandError('REQUEST_TOO_LARGE');
  return result;
}
