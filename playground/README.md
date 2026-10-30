# Reservation playground

This native TypeScript consumer borrows the CSAssay workflow: declare requirements, preserve a weak baseline, execute boundary probes, retain mutation/compiler evidence, and request a deterministic next investigation. It consumes the existing TypeScriptAssay API without changing checker rules, receipt meanings or admission.

```sh
npm run playground
node dist/src/cli.js verify playground/reservation --json artifacts/reservation.json --sarif artifacts/reservation.sarif
```

Each playground run retains a new ignored artifacts/playground-\* directory. baseline.json is the existing engine receipt, baseline.sarif is its finding projection, and mutation-cases.json binds source/test/requirement/config hashes plus actual compiler/test output for five isolated mutations. Tests use readonly discriminated unions, Object.freeze runtime checks, unknown input decoding and pure domain functions.

The weak selection has three tests; the expanded selection has fourteen. Zero-quantity and exact-stock mutations survive the original selection and are killed by the expanded suite. Wrong arithmetic is already killed. Syntax-invalid source remains Invalid. The integer-equivalent candidate remains an unresolved survivor, requiring contract review; no automatic equivalence is granted. Advice cannot change the engine verdict or execute commands.

The pinned Node 20.20.2/npm 10.8.2 lane passed all 36 existing engine regressions, including the packed CLI installed into a clean consumer, plus 14 playground acceptance tests and 3 adapter regressions. The earlier Node 24.21.0 compatibility run and its engine-policy failure remain retained separately; its receipts still correctly record pinnedRuntimeMatched=false. The TypeScript compiler remains exactly 5.7.3 from the existing lockfile. Existing verification command semantics and limitations remain unchanged; this wrapper additionally binds authored specimen files before/after the experiment.

When another Node version is your default, select the pinned SDK for each command without changing system defaults:

```sh
PATH="/path/to/node-v20.20.2-linux-x64/bin:$PATH" npm run playground
```

No model calls, package publication, remote writes, business-correctness claim or release approval occurs.

Run `npm run test:playground` for 14 acceptance tests plus 3 adapter regressions. The consumer clears old build output, resolves only the pinned 5.7.3 compiler, records compiler/source/emission hashes and requires at least 14 executed tests with zero failed/cancelled/skipped cases. An environment compiler override is ignored; failed compilation cannot reuse stale output. Unknown transport data must have own data properties; accessors and descriptor failures return InvalidInput.

See [phase-1 portable convergence](CONVERGENCE.md) for the next bounded boundary
candidate and its explicit exclusions.
