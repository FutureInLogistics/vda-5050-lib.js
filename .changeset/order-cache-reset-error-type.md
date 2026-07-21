---
"vda-5050-lib": minor
---

feat(master-controller): mark `discardOrderCache` resets with a dedicated error type

The synthetic error passed to `onOrderProcessed` when `discardOrderCache` resets an order cache used `ErrorType.Order`, which is indistinguishable from an order the AGV itself rejected or failed. Consumers that need to react differently to a local cache reset (e.g. failing the corresponding job without faulting the vehicle) had to fall back on matching the error description.

- Adds `ErrorType.OrderCacheReset` (`"orderCacheResetError"`).
- `discardOrderCache` now reports its reset error with that type.
