/** @file GENERATED из docs/contracts/openapi.json; pnpm web:api:generate. Не редактировать вручную. */
export interface paths {
    "/api/v1/warehouses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DirectoryReadController_listWarehouses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DirectoryReadController_listProducts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/locations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DirectoryReadController_listLocations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/balances": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listBalances"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listMovements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/putaway-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listPutawayTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listReceipts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/picking-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listPickingTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/shipments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listShipments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/warehouses/{warehouseId}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WarehouseReadController_listAuditEntries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AppController_getHello"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AppController_getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Войти по логину/паролю; серверная cookie-сессия */
        post: operations["IdentityController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["IdentityController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IdentityController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/identity/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IdentityAdminController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/identity/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["IdentityAdminController_update"];
        trace?: never;
    };
    "/api/v1/identity/users/{userId}/warehouses/{warehouseId}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IdentityAdminController_roles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/identity/users/{userId}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["IdentityAdminController_revokeAll"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/identity/users/{userId}/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["IdentityAdminController_revoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments/{shipmentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ShippingController_read"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}/shipments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShippingController_prepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments/{shipmentId}/post": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShippingController_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shipments/{shipmentId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShippingController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}/cancellation-return": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShippingController_completeReturn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FulfillmentController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FulfillmentController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FulfillmentController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}/reserve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FulfillmentController_reserve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}/allocations/{allocationId}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FulfillmentController_release"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FulfillmentController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks/{taskId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PickingController_read"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{orderId}/picking-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PickingController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks/{taskId}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PickingController_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/picking-tasks/{taskId}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PickingController_confirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/putaway-tasks/{taskId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["InventoryController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/putaway-tasks/{taskId}/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["InventoryController_execute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/receipts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Создать draft (сессия и роль склада) */
        post: operations["ReceivingController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/receipts/{receiptId}/post": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Провести draft; posted с новым ключом → RECEIPT_ALREADY_POSTED */
        post: operations["ReceivingController_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/receipts/{receiptId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Прочитать документ (сессия и роль склада) */
        get: operations["ReceivingController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        WarehouseReadDto: {
            /** Format: uuid */
            id: string;
            code: string;
            name: string;
        };
        ProductReadDto: {
            /** Format: uuid */
            id: string;
            sku: string;
            name: string;
            /** @enum {string} */
            unit: "piece";
        };
        LocationReadDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            code: string;
            /** @enum {string} */
            kind: "receiving" | "storage" | "shipping";
        };
        BalanceDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            productId: string;
            /** Format: uuid */
            locationId: string;
            /** @enum {string} */
            locationKind: "receiving" | "storage" | "shipping";
            onHand: number;
            reserved: number;
            available: number;
        };
        MovementDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            productId: string;
            /** Format: uuid */
            locationId: string;
            /** @enum {string} */
            kind: "receipt" | "transfer-out" | "transfer-in" | "shipment";
            quantity: number;
            /** Format: uuid */
            auditId: string;
            /** Format: uuid */
            operationId: string;
            /** Format: uuid */
            transferId: string | null;
            /** Format: uuid */
            pickingTransferId: string | null;
            /** Format: uuid */
            shippingEffectId: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        PutawaySummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            productId: string;
            /** Format: uuid */
            sourceReceiptId: string;
            /** Format: uuid */
            sourceEventId: string;
            /** @enum {string} */
            status: "pending" | "completed";
            quantity: number;
            /** Format: date-time */
            createdAt: string;
        };
        ReceiptSummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            receivingLocationId: string;
            /** @enum {string} */
            status: "draft" | "posted";
            /** Format: uuid */
            postedEventId: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        OrderSummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** @enum {string} */
            status: "draft" | "active" | "cancel_pending" | "cancelled" | "completed" | "closed_mixed";
        };
        PickingSummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            orderId: string;
            /** @enum {string} */
            status: "ready" | "in_progress" | "shortage" | "completed" | "cancelled";
            /** Format: uuid */
            assigneeId: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        ShipmentSummaryDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            orderId: string;
            /** @enum {string} */
            status: "draft" | "posted" | "cancelled";
            reasonCode: string;
            /** Format: date-time */
            createdAt: string;
        };
        AuditSummaryDto: {
            /** Format: uuid */
            id: string;
            actorType: string;
            /** Format: uuid */
            actorId: string;
            action: string;
            /** @enum {string} */
            entityType: "warehouse" | "location" | "stock-balance" | "allocation" | "receipt" | "putaway-task" | "order" | "picking-task" | "shipment";
            /** Format: uuid */
            entityId: string;
            /** Format: uuid */
            correlationId: string;
            reasonCode: string;
            hasRedactedChanges: boolean;
            /** Format: date-time */
            occurredAt: string;
        };
        LoginDto: {
            /** @example operator.one */
            login: string;
            password: string;
        };
        UserProfileDto: {
            /** Format: uuid */
            id: string;
            login: string;
            active: boolean;
            systemAdmin: boolean;
        };
        LoginResponseDto: {
            user: components["schemas"]["UserProfileDto"];
            csrfToken: string;
        };
        WarehouseGrantDto: {
            /** Format: uuid */
            warehouseId: string;
            /** @enum {string} */
            role: "viewer" | "warehouse_operator" | "order_manager" | "warehouse_supervisor";
        };
        CurrentUserDto: {
            user: components["schemas"]["UserProfileDto"];
            csrfToken: string;
            warehouseRoles: components["schemas"]["WarehouseGrantDto"][];
        };
        CreateUserDto: {
            /** @example operator.one */
            login: string;
            password: string;
            /** @default false */
            systemAdmin: boolean;
        };
        UpdateUserDto: {
            active?: boolean;
            systemAdmin?: boolean;
            password?: string;
        };
        SetWarehouseRolesDto: {
            roles: ("viewer" | "warehouse_operator" | "order_manager" | "warehouse_supervisor")[];
        };
        ShipmentLineDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            allocationId: string;
            quantity: number;
        };
        ShipmentDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            orderId: string;
            /** Format: uuid */
            warehouseId: string;
            /** @enum {string} */
            status: "draft" | "posted" | "cancelled";
            reasonCode: string;
            /** Format: date-time */
            postedAt: string | null;
            lines: components["schemas"]["ShipmentLineDto"][];
        };
        PrepareShipmentLineDto: {
            /** Format: uuid */
            allocationId: string;
            quantity: number;
        };
        PrepareShipmentDto: {
            reasonCode: string;
            lines: components["schemas"]["PrepareShipmentLineDto"][];
        };
        ReasonDto: {
            reasonCode: string;
        };
        CancellationReturnLineDto: {
            /** Format: uuid */
            lineId: string;
            /** Format: uuid */
            targetLocationId: string;
            quantity: number;
        };
        CancellationReturnDto: {
            reasonCode: string;
            lines: components["schemas"]["CancellationReturnLineDto"][];
        };
        AllocationDto: {
            consumed: number;
            /** Format: uuid */
            locationId: string;
            /** @enum {string} */
            state: "active" | "transferred" | "consumed" | "released" | "closed_mixed";
            transferred: number;
            /** @enum {string} */
            locationKind: "storage" | "shipping";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            balanceId: string;
            allocated: number;
            active: number;
            released: number;
        };
        OrderLineDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            productId: string;
            quantity: number;
            open: number;
            reservedStorage: number;
            reservedShipping: number;
            shipped: number;
            cancelled: number;
            allocations: components["schemas"]["AllocationDto"][];
        };
        OrderDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** @enum {string} */
            status: "draft" | "active" | "cancel_pending" | "cancelled" | "completed" | "closed_mixed";
            lines: components["schemas"]["OrderLineDto"][];
        };
        OrderLineInputDto: {
            /** Format: uuid */
            productId: string;
            quantity: number;
        };
        CreateOrderDto: {
            /** Format: uuid */
            warehouseId: string;
            lines: components["schemas"]["OrderLineInputDto"][];
        };
        ReserveOrderLineDto: {
            /** Format: uuid */
            lineId: string;
            quantity: number;
        };
        ReserveOrderDto: {
            lines: components["schemas"]["ReserveOrderLineDto"][];
        };
        ReleaseAllocationDto: {
            quantity: number;
        };
        PickingLineDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            allocationId: string;
            planned: number;
            pickedTotal: number;
            cancelledUnpicked: number;
            remaining: number;
        };
        PickingTaskDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            orderId: string;
            /** Format: uuid */
            warehouseId: string;
            /** @enum {string} */
            status: "ready" | "in_progress" | "shortage" | "completed" | "cancelled";
            /** Format: uuid */
            assigneeId: string | null;
            lines: components["schemas"]["PickingLineDto"][];
        };
        ConfirmPickingDto: {
            /** Format: uuid */
            taskLineId: string;
            actualQuantity: number;
            /** Format: uuid */
            targetLocationId?: string;
            shortage: boolean;
        };
        PutawayTaskResponseDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            sourceReceiptId: string;
            /** Format: uuid */
            sourceReceiptLineId: string;
            /** Format: uuid */
            sourceEventId: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            sourceLocationId: string;
            /** Format: uuid */
            productId: string;
            quantity: number;
            /** @enum {string} */
            status: "pending" | "completed";
            /** Format: uuid */
            targetLocationId: string | null;
            /** Format: date-time */
            completedAt: string | null;
            /** Format: uuid */
            completedEventId: string | null;
            /** Format: uuid */
            completionAuditId: string | null;
            /** Format: uuid */
            auditId: string;
            /** Format: date-time */
            createdAt: string;
        };
        ExecutePutawayDto: {
            /**
             * Format: uuid
             * @description Ячейка хранения того же склада; выполняется полное количество задания.
             */
            targetLocationId: string;
        };
        CreateReceiptLineDto: {
            /** Format: uuid */
            productId: string;
            /** @example 10 */
            quantity: number;
        };
        CreateReceiptDto: {
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            receivingLocationId: string;
            lines: components["schemas"]["CreateReceiptLineDto"][];
        };
        ReceiptLineDto: {
            /** Format: uuid */
            productId: string;
            /** @example 10 */
            quantity: number;
            /** Format: uuid */
            id: string;
            position: number;
        };
        ReceiptDto: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            warehouseId: string;
            /** Format: uuid */
            receivingLocationId: string;
            /** @enum {string} */
            status: "draft" | "posted";
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            postedAt: string | null;
            /** Format: uuid */
            postedEventId: string | null;
            lines: components["schemas"]["ReceiptLineDto"][];
        };
        Problem: {
            /** Format: uri */
            type: string;
            title: string;
            status: number;
            detail: string;
            instance: string;
            /** @enum {string} */
            code: "SHIPMENT_NOT_FOUND" | "PICKING_TASK_NOT_FOUND" | "ORDER_NOT_FOUND" | "ORDER_STATE_CONFLICT" | "ALLOCATION_NOT_FOUND" | "PUTAWAY_TASK_NOT_FOUND" | "PUTAWAY_ALREADY_COMPLETED" | "INVALID_PUTAWAY_LOCATION" | "INSUFFICIENT_STOCK" | "USER_NOT_FOUND" | "LAST_ADMIN_REQUIRED" | "CSRF_REJECTED" | "TOO_MANY_REQUESTS" | "RECEIPT_NOT_FOUND" | "RECEIPT_ALREADY_POSTED" | "INVALID_RECEIPT" | "PRODUCT_NOT_FOUND" | "LOCATION_NOT_FOUND" | "INVALID_RECEIVING_LOCATION" | "STOCK_LIMIT_EXCEEDED" | "VALIDATION_FAILED" | "INVALID_CORRELATION_ID" | "IDEMPOTENCY_KEY_REQUIRED" | "INVALID_IDEMPOTENCY_KEY" | "DEV_ACTOR_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "REQUEST_TOO_LARGE" | "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "OPERATION_REJECTED" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR";
            /** Format: uuid */
            correlationId: string;
        };
    };
    responses: never;
    parameters: {
        /** @description Scope actor/operation/key: изменённый нормализованный запрос с тем же ключом → 409. Повтор возвращает сохранённый status/body/Location. */
        IdempotencyKey: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    DirectoryReadController_listWarehouses: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["WarehouseReadDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    DirectoryReadController_listProducts: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["ProductReadDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    DirectoryReadController_listLocations: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["LocationReadDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listBalances: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                locationKind?: "receiving" | "storage" | "shipping";
                productId?: string;
                locationId?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["BalanceDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listMovements: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                productId?: string;
                locationId?: string;
                kind?: "receipt" | "transfer-out" | "transfer-in" | "shipment";
                auditId?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["MovementDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listPutawayTasks: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                productId?: string;
                status?: "pending" | "completed";
                sourceReceiptId?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["PutawaySummaryDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listReceipts: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                status?: "draft" | "posted";
                receivingLocationId?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["ReceiptSummaryDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listOrders: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                status?: "draft" | "active" | "cancel_pending" | "cancelled" | "completed" | "closed_mixed";
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["OrderSummaryDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listPickingTasks: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                status?: "ready" | "in_progress" | "shortage" | "completed" | "cancelled";
                orderId?: string;
                assigneeId?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["PickingSummaryDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listShipments: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                status?: "draft" | "posted" | "cancelled";
                orderId?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["ShipmentSummaryDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    WarehouseReadController_listAuditEntries: {
        parameters: {
            query?: {
                limit?: string;
                cursor?: string;
                entityType?: "warehouse" | "location" | "stock-balance" | "allocation" | "receipt" | "putaway-task" | "order" | "picking-task" | "shipment";
                entityId?: string;
                correlationId?: string;
            };
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["AuditSummaryDto"][];
                        nextCursor: string | null;
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    AppController_getHello: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Имя технического API без бизнес-эффектов. */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    AppController_getHealth: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Liveness процесса, не readiness БД. */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "ok";
                    };
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityController_login: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Protection": "1";
                Origin: string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginDto"];
            };
        };
        responses: {
            /** @description Безопасный user и csrfToken; session token только в HttpOnly Set-Cookie. */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponseDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Неверные credentials или заблокированный пользователь. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Окно попыток входа исчерпано. */
            429: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityController_me: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Текущий user, его warehouseRoles, csrfToken. */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentUserDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityController_logout: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Текущая сессия отозвана, cookie очищена. */
            204: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityAdminController_create: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUserDto"];
            };
        };
        responses: {
            /** @description Созданный безопасный профиль. */
            201: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserProfileDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityAdminController_update: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateUserDto"];
            };
        };
        responses: {
            /** @description Обновлённый безопасный профиль. */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserProfileDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityAdminController_roles: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                userId: string;
                warehouseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetWarehouseRolesDto"];
            };
        };
        responses: {
            /** @description Роли целевого склада заменены. */
            201: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityAdminController_revokeAll: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Все сессии пользователя отозваны. */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    IdentityAdminController_revoke: {
        parameters: {
            query?: never;
            header: {
                "X-CSRF-Token": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                userId: string;
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Сессия адресно отозвана. */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ShippingController_read: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ShippingController_prepare: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PrepareShipmentDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ShippingController_post: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ShippingController_cancel: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                shipmentId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ShippingController_completeReturn: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CancellationReturnDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    FulfillmentController_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order snapshot: id, warehouseId, status, lines with open/reservedStorage/cancelled and allocation history */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    FulfillmentController_create: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOrderDto"];
            };
        };
        responses: {
            /** @description Draft order snapshot */
            201: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    FulfillmentController_confirm: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Active order snapshot */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    FulfillmentController_reserve: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReserveOrderDto"];
            };
        };
        responses: {
            /** @description Order snapshot with active allocations */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    FulfillmentController_release: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
                allocationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReleaseAllocationDto"];
            };
        };
        responses: {
            /** @description Order snapshot after release */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    FulfillmentController_cancel: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Cancel pending or closed order remainder */
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    PickingController_read: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PickingTaskDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    PickingController_create: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                orderId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            201: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PickingTaskDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    PickingController_start: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PickingTaskDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    PickingController_confirm: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmPickingDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PickingTaskDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    InventoryController_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PutawayTaskResponseDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description PUTAWAY_TASK_NOT_FOUND */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    InventoryController_execute: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                taskId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExecutePutawayDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PutawayTaskResponseDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description PUTAWAY_TASK_NOT_FOUND */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ReceivingController_create: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateReceiptDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    /** @description Относительный URL документа. */
                    Location?: string;
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceiptDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ReceivingController_post: {
        parameters: {
            query?: never;
            header: {
                /** @description Один UUID на actor/operation/request. Тот же ключ и другой нормализованный запрос → 409. */
                "Idempotency-Key": string;
                /** @description Точное значение AUTH_ORIGIN. */
                Origin: string;
                /** @description CSRF текущей сессии из login/me. */
                "X-CSRF-Token": string;
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                receiptId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceiptDto"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description RECEIPT_NOT_FOUND */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            409: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            413: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            422: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; коды описаны в components.schemas.Problem. */
            503: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ReceivingController_get: {
        parameters: {
            query?: never;
            header?: {
                /** @description Не задан → UUID сервера; некорректный → 400. Ответ содержит X-Correlation-Id. */
                "X-Correlation-Id"?: string;
            };
            path: {
                receiptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceiptDto"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            400: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            401: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description FORBIDDEN */
            403: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            404: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            /** @description Безопасный problem response; stack/driver input не раскрываются. */
            500: {
                headers: {
                    /** @description Идентификатор текущего HTTP запроса, включая replay. */
                    "X-Correlation-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}

/** Лимиты формы из OpenAPI. Freeze предотвращает случайную замену общих чисел в UI; сервер повторно проверяет DTO. */
export const CONTRACT_LIMITS = Object.freeze({"quantityMax":2147483647,"receiptLines":1000,"orderLines":1000});
