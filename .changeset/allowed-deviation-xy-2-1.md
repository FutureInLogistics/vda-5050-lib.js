---
"vda-5050-lib": major
---

fix(schema): correct misspelled `allowedDeviationXy` property in VDA 5050 2.1

The VDA 5050 2.1 specification names the node position deviation property `allowedDeviationXY`, but the JSON schema the generated sources are derived from spells it `allowedDeviationXy`. As the 2.1 types are also the library's default (unversioned) exports, orders published with the misspelled property were ignored by specification-conforming AGVs.

- `NodePosition.allowedDeviationXy` (default export and `V2_1`) is renamed to `allowedDeviationXY` (breaking change for code that sets the misspelled property).
- `VirtualAgvAdapter.isNodeWithinDeviationRange` now reads `allowedDeviationXY` from the node position and reports it under the error reference key `nodePosition.allowedDeviationXY` (breaking change for code matching on the old key).

Note that the affected type declarations are generated from the JSON schemas shipped with the vda-5050-cli package, so this correction must be reapplied whenever they are regenerated, until the typo is fixed upstream in those schemas.
