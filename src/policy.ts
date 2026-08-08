import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BaselineEntry, EscapeHatchPolicy, Policy } from './model.js';
import { canonicalJson, sha256 } from './canonical.js';

const POLICY_FILE = '.tsassay.json';

type JsonObject = Record<string, unknown>;

const object = (value: unknown, label: string): JsonObject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
};

const strings = (value: unknown, label: string, allowEmpty = false): readonly string[] => {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error(`${label} must be a ${allowEmpty ? '' : 'non-empty '}array of strings`);
  }
  return [...value].sort((left, right) => left.localeCompare(right));
};

const noUnknownKeys = (value: JsonObject, allowed: readonly string[], label: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} has unknown key ${key}`);
  }
};

const escapeHatches = (value: unknown): EscapeHatchPolicy => {
  const record = object(value, 'escapeHatches');
  noUnknownKeys(record, ['assertions', 'nonNullAssertions', 'directives'], 'escapeHatches');
  const treatment = (key: keyof EscapeHatchPolicy): 'forbid' | 'allow-with-receipt' => {
    const entry = record[key];
    if (entry !== 'forbid' && entry !== 'allow-with-receipt') {
      throw new Error(`escapeHatches.${key} must be forbid or allow-with-receipt`);
    }
    return entry;
  };
  return {
    assertions: treatment('assertions'),
    nonNullAssertions: treatment('nonNullAssertions'),
    directives: treatment('directives')
  };
};

const baseline = (value: unknown, profile: string): readonly BaselineEntry[] => {
  if (value === undefined && profile === 'new') return [];
  if (value === undefined) throw new Error('converge policy requires a reviewed baseline array');
  if (!Array.isArray(value)) throw new Error('baseline must be an array');
  return value
    .map((entry, index) => {
      const record = object(entry, `baseline[${index}]`);
      noUnknownKeys(
        record,
        ['fingerprint', 'rationale', 'reviewedBy', 'reviewedAt'],
        `baseline[${index}]`
      );
      for (const key of ['fingerprint', 'rationale', 'reviewedBy', 'reviewedAt']) {
        if (typeof record[key] !== 'string' || record[key].length === 0) {
          throw new Error(`baseline[${index}].${key} must be a non-empty string`);
        }
      }
      return {
        fingerprint: record.fingerprint as string,
        rationale: record.rationale as string,
        reviewedBy: record.reviewedBy as string,
        reviewedAt: record.reviewedAt as string
      };
    })
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
};

export interface LoadedPolicy {
  readonly root: string;
  readonly path: string;
  readonly policy: Policy;
  readonly digest: string;
}

export const findPolicyPath = (target: string): string | null => {
  let directory = resolve(target);
  if (!existsSync(directory)) return null;
  if (!directory.endsWith('.ts') && !directory.endsWith('.tsx')) directory = resolve(directory);
  else directory = dirname(directory);
  for (;;) {
    const candidate = resolve(directory, POLICY_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
};

export const loadPolicy = (target: string): LoadedPolicy => {
  const path = findPolicyPath(target);
  if (path === null) throw new Error(`No ${POLICY_FILE} found for target ${resolve(target)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid policy JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const record = object(raw, 'policy');
  noUnknownKeys(
    record,
    [
      'schemaVersion',
      'profile',
      'domainGlobs',
      'boundaryGlobs',
      'excludedGlobs',
      'requiredCommands',
      'escapeHatches',
      'discriminantFields',
      'transportTypeNames',
      'baseline'
    ],
    'policy'
  );
  if (record.schemaVersion !== 'ts-assay-policy/0.1')
    throw new Error('policy.schemaVersion must be ts-assay-policy/0.1');
  if (record.profile !== 'new' && record.profile !== 'converge')
    throw new Error('policy.profile must be new or converge');
  const policy: Policy = {
    schemaVersion: record.schemaVersion,
    profile: record.profile,
    domainGlobs: strings(record.domainGlobs, 'domainGlobs'),
    boundaryGlobs: strings(record.boundaryGlobs ?? [], 'boundaryGlobs', true),
    excludedGlobs: strings(record.excludedGlobs ?? [], 'excludedGlobs', true),
    requiredCommands: strings(record.requiredCommands, 'requiredCommands', true),
    escapeHatches: escapeHatches(record.escapeHatches),
    discriminantFields: strings(
      record.discriminantFields ?? ['kind', 'type'],
      'discriminantFields'
    ),
    transportTypeNames: strings(record.transportTypeNames ?? [], 'transportTypeNames', true),
    baseline: baseline(record.baseline, record.profile)
  };
  const duplicateBaseline = policy.baseline.find(
    (entry, index, entries) => index > 0 && entry.fingerprint === entries[index - 1]?.fingerprint
  );
  if (duplicateBaseline !== undefined)
    throw new Error(`Duplicate baseline fingerprint ${duplicateBaseline.fingerprint}`);
  return { root: dirname(path), path, policy, digest: sha256(canonicalJson(policy)) };
};
