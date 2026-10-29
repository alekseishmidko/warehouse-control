/** @file GENERATED из docs/contracts/events: pnpm contracts:generate. Не редактировать вручную. */
/**
 * Факт полного размещения задания: receiving → storage того же склада, без изменения общего количества и без переноса резерва.
 */
export interface PutawayCompletedV1 {
  /**
   * UUID события. Сохраняется при повторной доставке и смене транспорта; используется для дедупликации.
   */
  eventId: string;
  /**
   * Имя бизнес-факта. Вместе со schemaVersion выбирает точный контракт в локальном registry.
   */
  type: 'inventory.putaway-completed';
  /**
   * Major-версия контракта. Неизвестная версия отклоняется до вызова handler.
   */
  schemaVersion: 1;
  /**
   * Агрегат задания размещения; sequence независим от receipt.
   */
  aggregateType: 'putaway-task';
  /**
   * UUID задания, равен payload.taskId; проверяет inventory.
   */
  aggregateId: string;
  /**
   * Порядковая версия события агрегата: положительное целое в безопасном диапазоне JavaScript number. Атомарное выделение версии выполняет OutboxService в транзакции бизнес-сценария.
   */
  aggregateVersion: number;
  /**
   * Время бизнес-факта RFC 3339 с UTC Z. format проверяет дату и время, pattern запрещает timezone offsets даже +00:00.
   */
  occurredAt: string;
  /**
   * UUID сквозного сценария для связи бизнес-операции, аудита и обработки события.
   */
  correlationId: string;
  /**
   * Необязательный UUID события-причины. Для корневой команды поле отсутствует.
   */
  causationId?: string;
  /**
   * Необязательный trace context длиной до 512 символов. Семантическую проверку W3C выполнит OTel; schema ограничивает только тип и длину.
   */
  traceparent?: string;
  /**
   * Immutable факт завершения, business references/permissions проверяет сервис.
   */
  payload: {
    /**
     * Завершённое задание
     */
    taskId: string;
    /**
     * Исходная приёмка
     */
    receiptId: string;
    /**
     * Исходная строка приёмки
     */
    receiptLineId: string;
    /**
     * Склад обеих ячеек
     */
    warehouseId: string;
    /**
     * Receiving источник
     */
    sourceLocationId: string;
    /**
     * Storage назначение
     */
    targetLocationId: string;
    /**
     * Товар задания
     */
    productId: string;
    /**
     * Идентификатор пары movements, равен taskId
     */
    transferId: string;
    /**
     * Полное количество задания в целых штуках int4, без частичного исполнения.
     */
    quantity: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Факт проведения одной приёмки: envelope и фактически принятые строки. Не команда повторно начислить остаток. Неизвестные необязательные поля разрешены; общий размер JSON UTF-8 ограничивает EventContracts.
 */
export interface ReceivingPostedV1 {
  /**
   * UUID события. Сохраняется при повторной доставке и смене транспорта; используется для дедупликации.
   */
  eventId: string;
  /**
   * Имя бизнес-факта. Вместе со schemaVersion выбирает точный контракт в локальном registry.
   */
  type: 'receiving.receipt-posted';
  /**
   * Major-версия контракта. Неизвестная версия отклоняется до вызова handler.
   */
  schemaVersion: 1;
  /**
   * Тип агрегата-источника: документ приёмки.
   */
  aggregateType: 'receipt';
  /**
   * UUID документа-агрегата. Равенство payload.receiptId проверяет сервис приёмки, не JSON Schema.
   */
  aggregateId: string;
  /**
   * Порядковая версия события агрегата: положительное целое в безопасном диапазоне JavaScript number. Атомарное выделение версии выполняет OutboxService в транзакции бизнес-сценария.
   */
  aggregateVersion: number;
  /**
   * Время бизнес-факта RFC 3339 с UTC Z. format проверяет дату и время, pattern запрещает timezone offsets даже +00:00.
   */
  occurredAt: string;
  /**
   * UUID сквозного сценария для связи бизнес-операции, аудита и обработки события.
   */
  correlationId: string;
  /**
   * Необязательный UUID события-причины. Для корневой команды поле отсутствует.
   */
  causationId?: string;
  /**
   * Необязательный trace context длиной до 512 символов. Семантическую проверку W3C выполнит OTel; schema ограничивает только тип и длину.
   */
  traceparent?: string;
  /**
   * Фактические данные проведённой приёмки. Существование справочников, права и состояние документа проверяются бизнес-сервисом.
   */
  payload: {
    /**
     * UUID проведённого документа приёмки.
     */
    receiptId: string;
    /**
     * UUID склада приёмки. Принадлежность ячейки складу проверяется сервисом и ограничениями БД.
     */
    warehouseId: string;
    /**
     * UUID ячейки зоны приёмки, в которую начислен товар.
     */
    receivingLocationId: string;
    /**
     * От 1 до 1000 фактических строк приёмки. Уникальность строк относится к бизнес-валидации. Большие документы разделяют до проведения.
     *
     * @minItems 1
     * @maxItems 1000
     *
     * Items: Одна фактически принятая строка документа; все три поля обязательны.
     */
    lines: [
      {
        /**
         * UUID строки документа приёмки, связывающий последующие действия с исходной строкой.
         */
        receiptLineId: string;
        /**
         * UUID принятого товара. Schema проверяет формат, а не наличие товара в БД.
         */
        productId: string;
        /**
         * Принятое количество в целых штуках: 1..2147483647, согласовано с SQL int4 и inventory validation. Строки и дробные числа недопустимы.
         */
        quantity: number;
        [k: string]: unknown;
      },
      ...{
        /**
         * UUID строки документа приёмки, связывающий последующие действия с исходной строкой.
         */
        receiptLineId: string;
        /**
         * UUID принятого товара. Schema проверяет формат, а не наличие товара в БД.
         */
        productId: string;
        /**
         * Принятое количество в целых штуках: 1..2147483647, согласовано с SQL int4 и inventory validation. Строки и дробные числа недопустимы.
         */
        quantity: number;
        [k: string]: unknown;
      }[]
    ];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
