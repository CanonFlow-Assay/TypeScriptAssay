import type { Rule } from './model.js';
import { canonicalJson, sha256 } from './canonical.js';

export const rules: readonly Rule[] = [
  {
    id: 'TSA-B01',
    title: 'Boundary parameters do not claim a trusted domain type',
    severity: 'error',
    rationale: 'External representations are not trusted domain values.',
    observation:
      'In configured boundary files, exported function parameters whose annotation names a configured trusted domain type are reported. This is a bounded ownership check, not a proof that every JSON value was decoded.'
  },
  {
    id: 'TSA-B02',
    title: 'any is forbidden',
    severity: 'error',
    rationale: 'any erases TypeScript checking at the point it is used.',
    observation:
      'Reports explicit any syntax and compiler-reported implicit-any diagnostics in the selected scope.'
  },
  {
    id: 'TSA-B03',
    title: 'Soundness escape hatches are explicit policy evidence',
    severity: 'warning',
    rationale: 'Assertions and suppression directives bypass or suppress checking.',
    observation:
      'Reports as, type assertions, non-null assertions, @ts-ignore, and @ts-expect-error; policy chooses forbid or allow-with-receipt for each class.'
  },
  {
    id: 'TSA-D01',
    title: 'Domain failures do not throw',
    severity: 'error',
    rationale: 'Expected domain failure should remain explicit data.',
    observation:
      'Reports throw statements in configured domain files. It does not infer whether every function result is a result-like union.'
  },
  {
    id: 'TSA-D02',
    title: 'Configured discriminated unions are exhaustive',
    severity: 'error',
    rationale: 'A new union case should not silently fall through.',
    observation:
      'For switch expressions whose checked union members expose a configured string-literal discriminator, reports missing literal cases. A default clause alone is not accepted as proof of handling.'
  },
  {
    id: 'TSA-D03',
    title: 'Dynamic indexed access is refined before use',
    severity: 'error',
    rationale: 'Dynamic lookup can yield absent or unintended data.',
    observation:
      'Reports non-literal element access in domain files unless it is lexically guarded by key in object or Object.hasOwn(object, key). It is not a proof of every runtime key invariant.'
  },
  {
    id: 'TSA-I01',
    title: 'Public domain contracts do not expose mutable collection or object shapes',
    severity: 'error',
    rationale: 'Public mutable data permits callers to invalidate decisions after construction.',
    observation:
      'Reports Array, Map, Set and mutable object properties in exported domain type/interface declarations. readonly is static only; no deep runtime immutability is claimed.'
  },
  {
    id: 'TSA-I02',
    title: 'Domain mutation is forbidden',
    severity: 'error',
    rationale: 'Mutation obscures value flow and invalidates referential reasoning.',
    observation:
      'Reports assignments through a property/index and recognized mutating collection methods in configured domain files.'
  },
  {
    id: 'TSA-E01',
    title: 'Domain modules do not directly use known infrastructure effects',
    severity: 'error',
    rationale: 'Effects should be isolated at named boundaries.',
    observation:
      'Reports imports of known Node infrastructure modules and direct use of fetch, console, process, timers, Math.random, and Date.now in domain files.'
  },
  {
    id: 'TSA-E02',
    title: 'Domain modules do not depend on configured adapters',
    severity: 'error',
    rationale: 'The core should receive capability inputs rather than concrete adapters.',
    observation:
      'Reports a domain import that resolves to a configured boundary/adapters source file. It does not infer architectural intent beyond that dependency edge.'
  },
  {
    id: 'TSA-S01',
    title: 'Configured transport type names do not enter domain code',
    severity: 'error',
    rationale: 'Transport representation requires an explicit decoding boundary.',
    observation:
      'Reports references in domain files to a policy-listed transport/DTO type name. It does not prove runtime schema completeness.'
  }
];

export const ruleCatalogDigest = sha256(canonicalJson(rules));

export const findRule = (id: string): Rule | undefined => rules.find((rule) => rule.id === id);
