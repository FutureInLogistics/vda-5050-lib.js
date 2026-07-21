---
"vda-5050-lib": major
---

fix(schema): correct misspelled `allowedDeviationXy` property in VDA 5050 2.0

The VDA 5050 2.0 specification names the node position deviation property `allowedDeviationXY`, but the JSON schema the generated sources are derived from spells it `allowedDeviationXy`. Orders published with the misspelled property were therefore ignored by specification-conforming AGVs, and the pre-compiled validators did not validate the correctly spelled property.

- `V2_0.NodePosition.allowedDeviationXy` is renamed to `allowedDeviationXY` (breaking change for code that sets the misspelled property).
- The pre-compiled 2.0 validation functions now type- and range-check `allowedDeviationXY`.
