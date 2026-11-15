/** @file GENERATED из docs/contracts/kafka-topology.json: pnpm contracts:generate. Не редактировать вручную. */
export const kafkaTopology = {
  "receipt": {
    "topic": "warehouse.receiving.events",
    "consumers": [
      "inventory.putaway"
    ]
  },
  "putaway-task": {
    "topic": "warehouse.inventory.putaway.events",
    "consumers": []
  },
  "order": {
    "topic": "warehouse.fulfillment.order.events",
    "consumers": []
  },
  "picking-task": {
    "topic": "warehouse.fulfillment.picking.events",
    "consumers": []
  }
} as const;
