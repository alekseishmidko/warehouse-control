/** @file Локальный registry известных type/version: только доверенные generated schemas, без сети и ORM. */
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { eventSchemas } from './generated/event-schemas';
import type { ReceivingPostedV1 } from './generated/event-types';

// Обычный import 'ajv' выбирает другой dialect. Здесь явно нужен draft 2020-12,
// указанный в исходных schemas. Один экземпляр обслуживает все известные события.
const ajv = new Ajv2020({
  // Ошибки самой схемы (например, неизвестный keyword) должны обнаруживаться при загрузке.
  strict: true,
  // Достаточно первого нарушения: наружу всё равно выдаётся безопасный общий код.
  allErrors: false,
  // format должен проверяться, а не оставаться только описательной аннотацией.
  validateFormats: true,
  // Строка "10" не должна незаметно превращаться в quantity=10.
  coerceTypes: false,
  // Отсутствующие обязательные данные не восстанавливаются значениями по умолчанию.
  useDefaults: false,
  // Optional extensions сохраняются: удаление полей нарушило бы forward compatibility.
  removeAdditional: false,
});
// Ajv не поставляет стандартные formats самостоятельно. Full mode проверяет
// в том числе календарную корректность date-time; требование UTC Z задаёт schema.
addFormats(ajv, { mode: 'full' });

/**
 * Известные контракты по ключу `<type>:<schemaVersion>`.
 *
 * Validators компилируются один раз при импорте, а не для каждого сообщения.
 * Generic связывает успешную runtime-проверку с generated TypeScript-типом.
 * Object.freeze запрещает случайную замену записей registry после загрузки.
 * Новая версия требует schema, generation, registry, KnownEvent и fixtures.
 * Внешнего Kafka Schema Registry и загрузки schemas по сети здесь нет.
 */
export const EVENT_REGISTRY = Object.freeze({
  'receiving.receipt-posted:1': ajv.compile<ReceivingPostedV1>(eventSchemas['receiving.receipt-posted.v1']),
});

/** Максимальное число строк одного документа; берётся из schema для согласованности с будущим receiving DTO. */
export const MAX_RECEIPT_LINES = eventSchemas['receiving.receipt-posted.v1'].properties.payload.properties.lines.maxItems;

/**
 * Максимум 256 КиБ сериализованного JSON UTF-8 с envelope и неизвестными полями.
 * JavaScript string.length считает кодовые единицы UTF-16 и для этого лимита не подходит.
 * Сжатие транспорта не увеличивает допустимый размер исходного сообщения.
 */
export const MAX_EVENT_BYTES = 256 * 1024;
