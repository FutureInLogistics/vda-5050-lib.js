---
"vda-5050-lib": minor
---

feat(master-controller): add `getAllOrders` and `discardOrderCache` for order-cache recovery

- `MasterController.getAllOrders(agvId?)` returns plain-data snapshots (`OrderInfo`) of the order state caches the master currently tracks, including each order's pending node/edge actions with their last reported status — introspection to diagnose stuck or orphaned orders.
- `MasterController.discardOrderCache(agvId, orderId?, orderUpdateId?)` locally discards matching order state caches without publishing anything to the AGV; each discarded order's `onOrderProcessed` handler is invoked once with a synthetic reset error so awaiting application logic is released.
- Exports the new `OrderInfo` interface.
