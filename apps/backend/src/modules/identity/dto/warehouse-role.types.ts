/** @file Принятые роли склада и server-side действия ADR-0019; global system_admin сюда не входит. */

/** Принятые warehouse роли; system_admin хранится отдельно, не является доступом на все склады. */
export const WAREHOUSE_ROLES = [
  'viewer',
  'warehouse_operator',
  'order_manager',
  'warehouse_supervisor',
] as const;

/** Тип выводится из единственного runtime списка, чтобы DTO и policy не разошлись. */
export type WarehouseRole = (typeof WAREHOUSE_ROLES)[number];

/** Названия действий не задаются HTTP-клиентом; контроллер выбирает фиксированную permission. */
export type WarehouseAction =
  | 'read'
  | 'receive'
  | 'putaway'
  | 'order'
  | 'reserve'
  | 'pick'
  | 'ship'
  | 'cancel'
  | 'return'
  | 'adjust'
  | 'audit';
