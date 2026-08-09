# Philosophy

TypeScriptAssay separates advice from verification. Functional TypeScript guidance encourages `unknown`, narrowing, discriminated unions, immutable value flow, and explicit effect boundaries. This tool does not decide whether a system is well designed. It reports a small set of Compiler API/TypeChecker observations against an explicit policy.

The v0.1 design inspected these exact reference commits without modifying them: `ArunNotFound/functional-skills` `f9909563a3607c7f15bada12a8ac83020f1038aa` (`idiomatic-typescript`), `CanonFlow-Assay/FSharpAssay` `d89aa3d6fda885c36d68e21be99f75ef281631f2`, and `CanonFlow-Assay/CSharpAssay` `2fb9aa66cdf81946517191a68941b4c9babb1f0e`. It reuses their evidence-bounded principles, not implementation or wording.

Types are erased, JavaScript data can mutate, JSON is unchecked, and effects can look pure. Therefore a clean result never proves runtime validity or deep immutability. The tool preserves the distinction between what was observed and what remains human judgment.
