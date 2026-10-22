---
"vda-5050-lib": patch
---

fix(master-controller): complete canceled orders on an empty node/edge horizon

After a finished `cancelOrder`, a State with no node and edge states now invokes `onOrderProcessed` with `byCancelation` and inactive state, even if order actions were never reported as finished or failed. Without a cancelation, open actions still keep the order unprocessed.
