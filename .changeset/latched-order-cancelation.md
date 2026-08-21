---
"vda-5050-lib": patch
---

fix(master-controller): preserve cancellation until terminal order processing

Latch a finished `cancelOrder` across state messages so `onOrderProcessed` reliably reports `byCancelation` when the order reaches its terminal state.
