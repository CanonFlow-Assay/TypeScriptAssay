# Independent application lifecycle preview

Run from a clean committed checkout with the pinned Node 20.20.2/npm 10.8.2 SDK selected for this command:

```sh
PATH="/path/to/node-v20.20.2-linux-x64/bin:$PATH" npm run lifecycle -- /absolute/fresh/evidence-directory
```

The command builds when needed, packs a local archive, copies a native reservation application into a separate consumer, and installs that archive with npm offline and install scripts disabled. It compares every installed toolkit file with the actual archive member bytes and pins all installed dependency files, including the TypeScript compiler/driver. The consumer has no source-project reference to the producing checkout. Archives remain local; package versions, engine ranges and publication policy are unchanged.

The exercise records requirements intake and an original baseline with 14 named acceptance tests. It registers RejectOversizedSku (RES-003), adds one named acceptance test, retains its real assertion failure and engine Fail, then repairs only the decoder. The repaired candidate must rerun all 14 original tests and the new case, retain the original test files/commands/minima, requirements and wire-contract pin, and preserve the new acceptance file exactly as it was when the failure was recorded. A repaired candidate without the failing receipt is ContextRequired. The SKU limit is 12 UTF-16 code units after JavaScript String.trim; it uses the existing InvalidInput outcome.

Read qualification.json and commands.json in the requested fresh directory. Each intake, baseline, change plan, failing assessment, repaired assessment and investigation has its own retained directory. The original engine JSON and SARIF remain separate original artifacts. The application status is ReadyForReview, NotReady or ContextRequired; ReadyForReview requests review and does not grant release approval. The failing acceptance record remains NotReady and is never relabeled as passing evidence.

## Registered investigations

The application registers exactly two fixture-backed investigations. The contract check executes JSON round-trips of the original decoder/reservation shapes against a frozen wire contract. The resilience check runs a real loopback HTTP server and the authored stock adapter:503 followed by200 retries once and succeeds, repeated503 stops after two attempts, and malformed JSON becomes an explicit invalid reply. This is controlled local fixture execution, with no production-provider reliability claim.

The required contract check runs during each assessment. Optional investigations require an unchanged ready snapshot and consume a cooperating-process budget of three requests under an exclusive file lock. A fourth request returns BudgetExhausted without execution. Unknown probe IDs, modified registries, stale source/compiled output or modified evidence are rejected. These optional observations remain AdvisoryOnly and do not replace the engine receipt or mutate the application.

The installed CLI is:

```text
node node_modules/typescript-assay/workflow/cli.mjs intake --manifest /app/assay.app.json --output /evidence/intake
node node_modules/typescript-assay/workflow/cli.mjs verify --manifest /app/assay.app.json --output /evidence/baseline
node node_modules/typescript-assay/workflow/cli.mjs plan --manifest /app/assay.app.json --baseline /evidence/baseline/run.json --request /change.json --output /evidence/plan
node node_modules/typescript-assay/workflow/cli.mjs verify --manifest /app/assay.app.json --baseline /evidence/baseline/run.json --plan /evidence/plan/plan.json --output /evidence/failing
node node_modules/typescript-assay/workflow/cli.mjs verify --manifest /app/assay.app.json --baseline /evidence/baseline/run.json --plan /evidence/plan/plan.json --failure /evidence/failing/run.json --output /evidence/candidate
node node_modules/typescript-assay/workflow/cli.mjs investigate --manifest /app/assay.app.json --run /evidence/candidate/run.json --probe resilience --output /evidence/probe
```

Commands and paths in the reviewed application manifest are trusted local execution inputs. Execution uses node argument vectors with a 30-second timeout and process-group cleanup on Linux. Advice cannot create a command or select an unregistered action. Evidence destinations must be fresh and outside the application and installed toolkit inputs.

## Integrity and semantic checks

Snapshots bind exact authored scope, requirements, manifest, original tests, contract, policy/configuration, archive, installed toolkit and dependency/compiler bytes. TypeScript preparation clears prior output and binds the actual compiler, source and emitted modules; emitted files are checked again after assessment and before/after investigations. The manifest explicitly lists runtime files and unexpected source, dependency or emitted-file drift cannot authorize readiness.

A frozen receipt includes captured original input bytes plus hashes of the raw test/contract/preparation/engine observations. Reading a baseline recomputes named-test outcomes from original flat TAP, checks the complete required artifact set, reconstructs TypeScript's original source-content digest from captured bytes, checks source/compiler/emission and archive/package bindings, and recursively validates the baseline/plan/retained-failure chain. A ReadyForReview label with failed raw tests is rejected even if its companion checksum was recomputed. Duplicate JSON keys, including nested and escaped duplicates, are rejected before application/evidence/plan/package-pin interpretation.

These are local integrity and consistency checks. They are not signatures or independent execution attestations, cannot defend against a hostile owner forging every observation consistently, and do not establish full test sufficiency or universal business correctness. Snapshots detect stable before/after changes; transient edits restored between observations remain outside this detector. Dependency launcher symlinks under node_modules/.bin are not part of this lane's direct node invocations. The preview accepts the documented flat TAP shape and controlled application layout; it does not claim arbitrary framework/test-runner ingestion.

## Qualification

npm run test:lifecycle checks TAP/JSON adversaries. npm run lifecycle executes actual archive installation, the requirement loop, fixture probes, three-request budget, and negative controls for frozen minima/tests/contracts, missing failure evidence, changed acceptance, archive/package/compiler/source/evidence drift, forged readiness/raw-test projections, duplicate manifests/pins/plans, unregistered probes and output overlap. Run existing repository gates and playground regression commands too. Generated evidence stays under ignored artifacts/ and previous source identities remain intact.

Failed or interrupted stages retain every observation already produced: preparation/test/contract/engine argument vectors, exit or signal/error, stdout/stderr, source capture when available, and original engine files when present. Such receipts are explicitly partial ContextRequired observations. The reader permits diagnostic inspection without fabricating mandatory completed-run artifacts; plan/baseline/probe gates still require a semantically validated ready run. JSON bytes use fatal UTF-8 decoding. Original engine scope/maps, policy/catalog/config/lock identity, exact required command vectors and exit evidence must agree with the captured input.
