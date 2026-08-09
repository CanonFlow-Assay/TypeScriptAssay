# v0.1 rule catalog

All v0.1 rules are admitted and have a good and bad executable fixture under `tests/fixtures/rules`.

| ID      | Severity | Observation                                                                                                                     |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| TSA-B01 | error    | Exported boundary parameters cannot be annotated with a type declared in configured domain files; accept `unknown` then decode. |
| TSA-B02 | error    | Explicit `any` and TypeScript compiler implicit-any diagnostics are reported.                                                   |
| TSA-B03 | policy   | Assertions, non-null assertions, and suppression directives are reported with policy-selected error or warning severity.        |
| TSA-D01 | error    | `throw` statements in domain files are reported.                                                                                |
| TSA-D02 | error    | Missing cases in configured string-discriminated union switches are reported; default alone is not proof.                       |
| TSA-D03 | error    | Dynamic element access requires a recognized `in` or `Object.hasOwn` lexical guard.                                             |
| TSA-I01 | error    | Exported domain type/interface declarations cannot expose Array, Map, Set, or non-readonly object properties.                   |
| TSA-I02 | error    | Property/index writes, increments, and recognized collection mutators in domain files are reported.                             |
| TSA-E01 | error    | Known infrastructure imports and direct fetch/console/process/timer/random/time use in domain files are reported.               |
| TSA-E02 | error    | Domain imports resolving to configured boundary files are reported.                                                             |
| TSA-S01 | error    | Policy-listed transport/DTO type names referenced in domain code are reported.                                                  |

Use `ts-assay explain <id>` for the machine-readable title, rationale, exact observation boundary, and catalog digest.
