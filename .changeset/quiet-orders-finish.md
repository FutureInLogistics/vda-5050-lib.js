---
"vda-5050-lib": patch
---

fix(master-controller): only terminate orders for explicit order rejections

Order-less robot-condition errors and errors for the order currently reported in State no longer remove the order cache or invoke `onOrderProcessed` with an error. Rejections must use a recognized rejection type and reference an assigned `(orderId, orderUpdateId)` that the AGV did not accept.
