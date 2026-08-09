# M1 consumer reality evidence

This is a single-agent M1 exercise. It is not independent testing or a multi-agent review.

## Assay baseline

- merged `main` base: `a8087d7ed260dd5cac8f8e4e895b424c04942d9c`;
- M1 branch: `uplift/m1-consumer-reality`;
- TypeScriptAssay runtime: Node `20.20.2`, npm `10.8.2`, CLI `0.1.0`, and Compiler API `5.7.3`.

## Consumer selection

The consumer is [octokit/graphql.js](https://github.com/octokit/graphql.js), an MIT-licensed production GraphQL client for browsers and Node. The exact inspected and exercised revision is `af94a01b676ae066185b1e36507e3039bc118f34`.

It was selected because it is a modest, real TypeScript library with a root `package-lock.json`, a root `tsconfig.json` that extends an installed package configuration, six production source files, and standard local commands. Its tests use `fetch-mock`; no account, secret, browser, database, container, or paid service was used. Its declared Node requirement is `>= 20`; it has no `packageManager` field, so the exercise used the Assay's pinned npm `10.8.2`. The lockfile installs TypeScript `7.0.0`; that version is bound by the recorded lockfile digest, while the Assay's own semantic observation uses its pinned Compiler API `5.7.3`.

The consumer repository was cloned only into disposable local space. Its source, tracked configuration, lockfile, and remote history were not changed.

## Observed scope and policy

The local-only `.tsassay.json` used:

- `domainGlobs`: `src/**/*.ts`;
- `boundaryGlobs`: `[]` — no boundary surface was invented for this exercise;
- `excludedGlobs`: `node_modules/**`, `pkg/**`, `coverage/**`;
- required commands: `npm run build`, `npm test`;
- strict escape-hatch treatment; and
- `kind` and `type` discriminant fields.

The initial `new` profile observed 23 blocking findings in the unmodified consumer source and returned `Fail`, non-authoritative. A `converge` baseline then preserved all 23 exact fingerprints. Each entry names its exact source location, says it is observed unmodified legacy debt retained only for transparent M1 converge evidence, and is reviewed by `single-agent M1 consumer exercise` on `2026-08-09`. No baseline entry was removed or broadened after creation.

The final receipt records these six scanned and loaded paths:

- `src/error.ts`
- `src/graphql.ts`
- `src/index.ts`
- `src/types.ts`
- `src/version.ts`
- `src/with-defaults.ts`

It records no boundary or unloaded paths. It records 758 excluded TypeScript paths: 752 under `node_modules` and six generated declarations under `pkg`. `coverage/**` is an unmatched exclusion glob and remains visible in the receipt; it does not make the inclusion scope incomplete.

## Final consumer receipt

The final `verify` used a controlled clock of `2026-08-09T05:00:00.000Z` and returned `Pass` with `authoritative: true`, under the explicitly observed scope above. It retained all 23 baseline findings visibly.

The exact local-only policy, canonical receipt, SARIF report, and checksum manifest are committed in [the M1 evidence bundle](evidence/m1-octokit-graphqljs/). Verify the bundle from that directory with `sha256sum -c SHA256SUMS`.

| Evidence                     | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| consumer source content      | `22f74abdc3befbf35e6e2a6adf994f3461734c004c847f0c49aae049384335ce` |
| local converge policy        | `f8d89f83278a2b9cbc9a96ea7b8284c7317f2068e6916ae4e220b8a25ea92d00` |
| policy digest in receipt     | `62819ee3ae343183696951f127eaf15842435a133de46b57acf146d43e40d0d7` |
| rule catalogue               | `e80317f92de666c51a08e10f8a357c8b1d18abacbf13fd1c39ad7f77d74b475c` |
| consumer `package-lock.json` | `2f7f2894751f6d60045e8a42ca562ba81c5ffaecab162f53ea216fb5746422e1` |
| findings                     | `deb3a0085faabac95c81b2ae9bb6ae5172404ed9576ec3bcc00c8c457342c593` |
| canonical receipt file       | `2a907d848b25df6c8a74fe50f6f7579279a8ec3c06e2a5653bb6f3a75460e7bc` |
| canonical SARIF file         | `2e7b6a5fba3452877b5529bc463bdb2b8deaba759da527a6fc0cf3280eeef660` |

`npm run build` passed with exit code `0` and output digest `eef298431ca8e5cf8be6987fc9e53b8e59aeda49870703118476b4673a3e14bf`. `npm test` passed with exit code `0` and output digest `12f54901011ed5e1cd64708fdf6694cbd2d442279ededcf09fdfe4b44bf0e2a5`.

## Self-adversarial evidence

Every probe was performed only in the disposable clone and then removed or restored. No case returned `Pass`.

| Probe                                                            | Result                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Scoped unresolved import                                         | `Fail`, non-authoritative: the consumer's required build and test commands failed and their output digests were bound to the receipt. |
| Policy-selected file outside the consumer `tsconfig` include set | `ToolFailure`, non-authoritative, with the file in `scope.unloadedPaths`.                                                             |
| Invalid policy profile                                           | `ToolFailure`, non-authoritative.                                                                                                     |
| Missing target                                                   | `ToolFailure`, non-authoritative.                                                                                                     |
| Unavailable required command                                     | `ToolFailure`, non-authoritative; command exit code `127` and output digest were recorded.                                            |
| New explicit-`any` source file after the converge baseline       | `Fail`, non-authoritative, with a new unbaselined `TSA-B02` finding.                                                                  |

No rule was added, weakened, or suppressed. The consumer did not reveal a project-discovery, `extends`, scope, receipt, or authority defect requiring a TypeScriptAssay code change.

## Limits and next slice

This receipt says only that the six named production TypeScript files were loaded by the pinned Assay Compiler API, the configured policy observed no new unbaselined blocking finding, and the consumer's two configured commands passed at the pinned lockfile state. It does not establish full workspace, browser, runtime, security, or business correctness. In particular, the consumer command chain uses its lockfile's TypeScript `7.0.0`, while the Assay's static observation intentionally remains pinned to TypeScript `5.7.3`.

The next smallest justified slice is to record the resolved `tsconfig`/`extends` chain and effective compiler-options digest in the receipt. That would make external configuration provenance more explicit without claiming support for every workspace or expanding the policy catalogue.
