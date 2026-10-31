/** @file GENERATED из docs/contracts/events: pnpm contracts:generate. Не редактировать вручную. */
export const eventSchemas = {
  "fulfillment.order-changed.v1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:warehouse:events:fulfillment.order-changed:v1",
    "title": "OrderChangedV1",
    "type": "object",
    "required": [
      "eventId",
      "type",
      "schemaVersion",
      "aggregateType",
      "aggregateId",
      "aggregateVersion",
      "occurredAt",
      "correlationId",
      "payload"
    ],
    "properties": {
      "eventId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID события. Сохраняется при повторной доставке и смене транспорта; используется для дедупликации."
      },
      "type": {
        "const": "fulfillment.order-changed",
        "description": "Имя бизнес-факта. Вместе со schemaVersion выбирает точный контракт в локальном registry."
      },
      "schemaVersion": {
        "const": 1,
        "description": "Major-версия контракта. Неизвестная версия отклоняется до вызова handler."
      },
      "aggregateType": {
        "const": "order"
      },
      "aggregateId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID заказа, равен payload.orderId."
      },
      "aggregateVersion": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991,
        "description": "Порядковая версия события агрегата: положительное целое в безопасном диапазоне JavaScript number. Атомарное выделение версии выполняет OutboxService в транзакции бизнес-сценария."
      },
      "occurredAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$",
        "description": "Время бизнес-факта RFC 3339 с UTC Z. format проверяет дату и время, pattern запрещает timezone offsets даже +00:00."
      },
      "correlationId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID сквозного сценария для связи бизнес-операции, аудита и обработки события."
      },
      "causationId": {
        "type": "string",
        "format": "uuid",
        "description": "Необязательный UUID события-причины. Для корневой команды поле отсутствует."
      },
      "traceparent": {
        "type": "string",
        "maxLength": 512,
        "description": "Необязательный trace context длиной до 512 символов. Семантическую проверку W3C выполнит OTel; schema ограничивает только тип и длину."
      },
      "payload": {
        "type": "object",
        "required": [
          "orderId",
          "action"
        ],
        "properties": {
          "orderId": {
            "type": "string",
            "format": "uuid"
          },
          "action": {
            "enum": [
              "created",
              "confirmed",
              "reserved",
              "released",
              "cancelled"
            ]
          }
        }
      }
    },
    "description": "Факт изменения заказа, audit и allocations фиксируются в той же транзакции."
  },
  "inventory.putaway-completed.v1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:warehouse:events:inventory.putaway-completed:v1",
    "title": "PutawayCompletedV1",
    "type": "object",
    "required": [
      "eventId",
      "type",
      "schemaVersion",
      "aggregateType",
      "aggregateId",
      "aggregateVersion",
      "occurredAt",
      "correlationId",
      "payload"
    ],
    "properties": {
      "eventId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID события. Сохраняется при повторной доставке и смене транспорта; используется для дедупликации."
      },
      "type": {
        "const": "inventory.putaway-completed",
        "description": "Имя бизнес-факта. Вместе со schemaVersion выбирает точный контракт в локальном registry."
      },
      "schemaVersion": {
        "const": 1,
        "description": "Major-версия контракта. Неизвестная версия отклоняется до вызова handler."
      },
      "aggregateType": {
        "const": "putaway-task",
        "description": "Агрегат задания размещения; sequence независим от receipt."
      },
      "aggregateId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID задания, равен payload.taskId; проверяет inventory."
      },
      "aggregateVersion": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991,
        "description": "Порядковая версия события агрегата: положительное целое в безопасном диапазоне JavaScript number. Атомарное выделение версии выполняет OutboxService в транзакции бизнес-сценария."
      },
      "occurredAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$",
        "description": "Время бизнес-факта RFC 3339 с UTC Z. format проверяет дату и время, pattern запрещает timezone offsets даже +00:00."
      },
      "correlationId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID сквозного сценария для связи бизнес-операции, аудита и обработки события."
      },
      "causationId": {
        "type": "string",
        "format": "uuid",
        "description": "Необязательный UUID события-причины. Для корневой команды поле отсутствует."
      },
      "traceparent": {
        "type": "string",
        "maxLength": 512,
        "description": "Необязательный trace context длиной до 512 символов. Семантическую проверку W3C выполнит OTel; schema ограничивает только тип и длину."
      },
      "payload": {
        "type": "object",
        "required": [
          "taskId",
          "receiptId",
          "receiptLineId",
          "warehouseId",
          "sourceLocationId",
          "targetLocationId",
          "productId",
          "transferId",
          "quantity"
        ],
        "properties": {
          "taskId": {
            "type": "string",
            "format": "uuid",
            "description": "Завершённое задание"
          },
          "receiptId": {
            "type": "string",
            "format": "uuid",
            "description": "Исходная приёмка"
          },
          "receiptLineId": {
            "type": "string",
            "format": "uuid",
            "description": "Исходная строка приёмки"
          },
          "warehouseId": {
            "type": "string",
            "format": "uuid",
            "description": "Склад обеих ячеек"
          },
          "sourceLocationId": {
            "type": "string",
            "format": "uuid",
            "description": "Receiving источник"
          },
          "targetLocationId": {
            "type": "string",
            "format": "uuid",
            "description": "Storage назначение"
          },
          "productId": {
            "type": "string",
            "format": "uuid",
            "description": "Товар задания"
          },
          "transferId": {
            "type": "string",
            "format": "uuid",
            "description": "Идентификатор пары movements, равен taskId"
          },
          "quantity": {
            "type": "integer",
            "minimum": 1,
            "maximum": 2147483647,
            "description": "Полное количество задания в целых штуках int4, без частичного исполнения."
          }
        },
        "description": "Immutable факт завершения, business references/permissions проверяет сервис."
      }
    },
    "description": "Факт полного размещения задания: receiving → storage того же склада, без изменения общего количества и без переноса резерва."
  },
  "receiving.receipt-posted.v1": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "urn:warehouse:events:receiving.receipt-posted:v1",
    "title": "ReceivingPostedV1",
    "type": "object",
    "required": [
      "eventId",
      "type",
      "schemaVersion",
      "aggregateType",
      "aggregateId",
      "aggregateVersion",
      "occurredAt",
      "correlationId",
      "payload"
    ],
    "properties": {
      "eventId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID события. Сохраняется при повторной доставке и смене транспорта; используется для дедупликации."
      },
      "type": {
        "const": "receiving.receipt-posted",
        "description": "Имя бизнес-факта. Вместе со schemaVersion выбирает точный контракт в локальном registry."
      },
      "schemaVersion": {
        "const": 1,
        "description": "Major-версия контракта. Неизвестная версия отклоняется до вызова handler."
      },
      "aggregateType": {
        "const": "receipt",
        "description": "Тип агрегата-источника: документ приёмки."
      },
      "aggregateId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID документа-агрегата. Равенство payload.receiptId проверяет сервис приёмки, не JSON Schema."
      },
      "aggregateVersion": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991,
        "description": "Порядковая версия события агрегата: положительное целое в безопасном диапазоне JavaScript number. Атомарное выделение версии выполняет OutboxService в транзакции бизнес-сценария."
      },
      "occurredAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "Z$",
        "description": "Время бизнес-факта RFC 3339 с UTC Z. format проверяет дату и время, pattern запрещает timezone offsets даже +00:00."
      },
      "correlationId": {
        "type": "string",
        "format": "uuid",
        "description": "UUID сквозного сценария для связи бизнес-операции, аудита и обработки события."
      },
      "causationId": {
        "type": "string",
        "format": "uuid",
        "description": "Необязательный UUID события-причины. Для корневой команды поле отсутствует."
      },
      "traceparent": {
        "type": "string",
        "maxLength": 512,
        "description": "Необязательный trace context длиной до 512 символов. Семантическую проверку W3C выполнит OTel; schema ограничивает только тип и длину."
      },
      "payload": {
        "type": "object",
        "required": [
          "receiptId",
          "warehouseId",
          "receivingLocationId",
          "lines"
        ],
        "properties": {
          "receiptId": {
            "type": "string",
            "format": "uuid",
            "description": "UUID проведённого документа приёмки."
          },
          "warehouseId": {
            "type": "string",
            "format": "uuid",
            "description": "UUID склада приёмки. Принадлежность ячейки складу проверяется сервисом и ограничениями БД."
          },
          "receivingLocationId": {
            "type": "string",
            "format": "uuid",
            "description": "UUID ячейки зоны приёмки, в которую начислен товар."
          },
          "lines": {
            "type": "array",
            "minItems": 1,
            "maxItems": 1000,
            "items": {
              "type": "object",
              "required": [
                "receiptLineId",
                "productId",
                "quantity"
              ],
              "properties": {
                "receiptLineId": {
                  "type": "string",
                  "format": "uuid",
                  "description": "UUID строки документа приёмки, связывающий последующие действия с исходной строкой."
                },
                "productId": {
                  "type": "string",
                  "format": "uuid",
                  "description": "UUID принятого товара. Schema проверяет формат, а не наличие товара в БД."
                },
                "quantity": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 2147483647,
                  "description": "Принятое количество в целых штуках: 1..2147483647, согласовано с SQL int4 и inventory validation. Строки и дробные числа недопустимы."
                }
              },
              "description": "Одна фактически принятая строка документа; все три поля обязательны."
            },
            "description": "От 1 до 1000 фактических строк приёмки. Уникальность строк относится к бизнес-валидации. Большие документы разделяют до проведения."
          }
        },
        "description": "Фактические данные проведённой приёмки. Существование справочников, права и состояние документа проверяются бизнес-сервисом."
      }
    },
    "description": "Факт проведения одной приёмки: envelope и фактически принятые строки. Не команда повторно начислить остаток. Неизвестные необязательные поля разрешены; общий размер JSON UTF-8 ограничивает EventContracts."
  }
} as const;
