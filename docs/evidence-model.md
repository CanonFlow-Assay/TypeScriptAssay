# Evidence model

The receipt is canonical JSON: object keys are recursively ordered, findings are ordered by normalized path, location, and rule ID, and a controlled clock may be supplied with `--clock` or `TS_ASSAY_CLOCK` for fixture testing. SARIF uses the same finding order.

Each verify receipt binds candidate revision or source digest, policy/profile digest, catalog digest, lockfile digest, actual Node/npm/TypeScript/CLI versions, resolved project-config evidence, complete scope evidence, finding digest, required-command status/exit/output digest, verdict, authority, and SARIF digest.

`projectConfig.chain` lists the resolved root `tsconfig.json` followed by each resolved `extends` configuration, in Compiler API resolution order. Every readable entry binds its normalized path and SHA-256 digest of its exact file bytes; a resolved-but-unreadable entry records `digest: null`. When that chain is complete, `projectConfig.effectiveCompilerOptionsDigest` is the SHA-256 digest of the canonicalized effective `CompilerOptions` produced by the pinned Compiler API; otherwise it is `null`. A missing, unreadable, or invalid config produces a project failure and cannot be authoritative; the receipt then records incomplete project-config evidence rather than inventing a chain.

v0.1 discovers `package-lock.json` at or above the policy root. If it cannot find one, `verify` is `Inconclusive` and non-authoritative rather than guessing an npm dependency graph.

The only verdicts are `Pass`, `Fail`, `Inconclusive`, and `ToolFailure`. `Pass` is authoritative only for `verify` with complete successfully loaded scope, no tool failures, all required commands passed, and no new blocking findings. `scan` never treats its not-run commands as passed.
