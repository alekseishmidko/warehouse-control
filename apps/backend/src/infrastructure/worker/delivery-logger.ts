/** @file Локальный вывод диагностики доставки в stdout после завершения транзакции.
 * Не заменяет будущую централизованную систему логирования WMS-401 и не меняет результат в БД. */
import type { DeliveryDiagnostic } from '../../shared/diagnostics/delivery-diagnostic';
/** Пытается вывести одну строку JSON; ошибка вывода не запускает повтор уже зафиксированного эффекта.
 * @param status Серверная стадия обработки, а не произвольная строка от пользователя.
 * @param diagnostic Отфильтрованный результат deliveryDiagnostic без токена и payload.
 * @returns Ничего; исключение console.info подавляется. Долговечная история остаётся в БД. */
export function logDelivery(status: string, diagnostic: DeliveryDiagnostic): void {
  try { console.info(JSON.stringify({ event: 'worker.delivery', status, ...diagnostic })); }
  catch { /* Закрытый stdout не меняет результат БД; повторный вывод здесь мог бы вызвать рекурсивную ошибку. */ }
}
