# TypeScriptAssay

TypeScriptAssay is a deterministic engineering-policy verifier for explicitly scoped, functional TypeScript. Its governing law is:

```text
authority ≤ evidence ≤ observed scope
```

A pass means only: under the pinned toolchain, reviewed policy, and explicitly scanned scope, the stated checks observed no blocking violation. It is not a claim of universal correctness, runtime completeness, security certification, or business correctness.

The functional shape it protects is:

```text
unknown external input → runtime decode / validate → trusted immutable domain data
                       → explicit discriminated outcomes → named effect adapters
```

It is framework-neutral for inspected projects: their code need not use Node, fp-ts, Effect, Zod, Valibot, ArkType, React, Next.js, NestJS, or a result library. The `ts-assay` CLI itself runs on pinned Node `20.20.2`.

## What it is not

It is not an auto-refactoring engine, framework generator, AI-agent orchestrator, CI platform, test runner, runtime schema validator, security review, or replacement for human domain judgment. There is no `--fix`, telemetry, SaaS dependency, AI call, package publishing, or release automation in this repository.

## Install and run from this checkout

Node `20.20.2`, npm `10.8.2`, and TypeScript `5.7.3` are pinned in the repository and lockfile.

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
node dist/src/cli.js doctor examples/clean
node dist/src/cli.js verify examples/clean --json artifacts/receipt.json --sarif artifacts/report.sarif
node dist/src/cli.js explain TSA-D02
```

`doctor` describes installed tooling and policy readiness; it makes no compliance claim. `scan` performs static analysis and records required evidence as `not-run`. `verify` executes every configured required command and binds its status, exit code, and output digest to its receipt.

`verify` exits `0` for Pass, `1` for Fail, and `2` for Inconclusive or ToolFailure. Invalid policy, a missing target, a parser/project failure, incomplete source scope, unavailable required commands, and skipped evidence cannot become Pass.

## Policy

Create `.tsassay.json` at the project root:

```json
{
  "schemaVersion": "ts-assay-policy/0.1",
  "profile": "new",
  "domainGlobs": ["src/domain/**/*.ts"],
  "boundaryGlobs": ["src/adapters/**/*.ts"],
  "excludedGlobs": ["dist/**", "node_modules/**"],
  "requiredCommands": ["npm run typecheck", "npm test"],
  "escapeHatches": {
    "assertions": "forbid",
    "nonNullAssertions": "forbid",
    "directives": "forbid"
  },
  "discriminantFields": ["kind", "type"],
  "transportTypeNames": ["UserDto"]
}
```

See [scope and profiles](docs/scope-and-profiles.md), [the evidence model](docs/evidence-model.md), and the [rule catalog](docs/rule-catalog.md) for the complete v0.1 contract.

## Relationship to adjacent tools

| Tool or project                          | Role                                            | TypeScriptAssay difference                                                                                                 |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| TypeScript compiler                      | Type soundness and project diagnostics          | Uses its pinned Compiler API and TypeChecker to observe a narrow policy; it does not replace compilation.                  |
| ESLint                                   | Configurable syntactic/style linting            | Makes deterministic policy receipts tied to scope, command evidence, profiles, and authority.                              |
| Test runners                             | Execute behavioral tests                        | `verify` records their configured real exit evidence; it does not replace tests.                                           |
| Runtime schema validators                | Decode values at runtime                        | Does not validate JSON itself or select a validation library.                                                              |
| `functional-skills/idiomatic-typescript` | Guidance for agents and developers writing code | Teaches good functional TypeScript; this project checks selected observable properties of existing code.                   |
| FsAssay                                  | F# verifier                                     | Shares evidence-bounded authority ideas, but has a TypeScript Compiler API implementation and TypeScript-specific hazards. |
| CSharpAssay                              | C# verifier                                     | Shares the four-state verdict discipline, but does not use Roslyn or make C# architecture claims.                          |

## Limits

`readonly` is static surface evidence, not deep runtime immutability. Classes, enums, assertions, and promises are not universal bans; assertions are explicit escape-hatch evidence and any other restriction must be an explicit future policy choice. Discriminated-union, dynamic-access, boundary, effect, and transport rules each observe the exact bounded subset stated in the catalog. No rule proves every external input was validated or every effect is pure.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Licensed under [Apache-2.0](LICENSE).
