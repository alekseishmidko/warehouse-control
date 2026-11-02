/** @file Внутренний контракт передачи shipment/return из fulfillment в inventory, не публичная ORM-модель. */
/** UUID/quantity поступают из проверенного документа под order lock; metadata передаётся отдельно. */
export interface ShippingAllocationCommand {
  /** UUID сохранённого shipping allocation своего заказа. */ allocationId: string;
  /** Положительные int4 штуки; inventory повторяет runtime-проверку. */ quantity: number;
  /** UUID immutable shipment line, обязателен для ship, отсутствует для return. */ shipmentLineId?: string;
  /** UUID storage своего склада, обязателен для return, отсутствует для ship. */ targetLocationId?: string;
}
