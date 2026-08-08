# Philosophy

TypeScriptAssay separates advice from verification. Functional TypeScript guidance encourages `unknown`, narrowing, discriminated unions, immutable value flow, and explicit effect boundaries. This tool does not decide whether a system is well designed. It reports a small set of Compiler API/TypeChecker observations against an explicit policy.

Types are erased, JavaScript data can mutate, JSON is unchecked, and effects can look pure. Therefore a clean result never proves runtime validity or deep immutability. The tool preserves the distinction between what was observed and what remains human judgment.
