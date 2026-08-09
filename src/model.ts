export type Profile = 'new' | 'converge';

export type Verdict =
  | { readonly kind: 'Pass' }
  | { readonly kind: 'Fail'; readonly findings: readonly Finding[] }
  | { readonly kind: 'Inconclusive'; readonly reason: string }
  | { readonly kind: 'ToolFailure'; readonly error: string };

export type Severity = 'error' | 'warning';

export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly message: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly fingerprint: string;
  readonly baseline: boolean;
}

export interface BaselineEntry {
  readonly fingerprint: string;
  readonly rationale: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

export interface EscapeHatchPolicy {
  readonly assertions: 'forbid' | 'allow-with-receipt';
  readonly nonNullAssertions: 'forbid' | 'allow-with-receipt';
  readonly directives: 'forbid' | 'allow-with-receipt';
}

export interface Policy {
  readonly schemaVersion: 'ts-assay-policy/0.1';
  readonly profile: Profile;
  readonly domainGlobs: readonly string[];
  readonly boundaryGlobs: readonly string[];
  readonly excludedGlobs: readonly string[];
  readonly requiredCommands: readonly string[];
  readonly escapeHatches: EscapeHatchPolicy;
  readonly discriminantFields: readonly string[];
  readonly transportTypeNames: readonly string[];
  readonly baseline: readonly BaselineEntry[];
}

export interface ScopeEvidence {
  readonly scannedPaths: readonly string[];
  readonly domainPaths: readonly string[];
  readonly boundaryPaths: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly unloadedPaths: readonly string[];
  readonly unmatchedGlobs: readonly string[];
  readonly complete: boolean;
}

export interface ConfigFileEvidence {
  readonly path: string;
  readonly digest: string | null;
}

export interface ProjectConfigEvidence {
  readonly chain: readonly ConfigFileEvidence[];
  readonly effectiveCompilerOptionsDigest: string | null;
  readonly complete: boolean;
}

export interface CommandEvidence {
  readonly command: string;
  readonly status: 'passed' | 'failed' | 'not-run' | 'tool-failure';
  readonly exitCode: number | null;
  readonly outputDigest: string | null;
}

export interface AnalysisResult {
  readonly findings: readonly Finding[];
  readonly scope: ScopeEvidence;
  readonly projectConfig: ProjectConfigEvidence;
  readonly analysisLimitations: readonly string[];
  readonly toolFailures: readonly string[];
}

export interface Receipt {
  readonly schemaVersion: 'ts-assay-receipt/0.1';
  readonly mode: 'scan' | 'verify';
  readonly generatedAt: string;
  readonly candidate: {
    readonly revision: string | null;
    readonly sourceContentDigest: string | null;
  };
  readonly policy: { readonly profile: Profile | null; readonly digest: string | null };
  readonly ruleCatalogDigest: string;
  readonly packageLockDigest: string | null;
  readonly toolchain: {
    readonly node: string;
    readonly packageManager: string;
    readonly typescript: string;
    readonly cli: string;
  };
  readonly projectConfig: ProjectConfigEvidence;
  readonly scope: ScopeEvidence;
  readonly findings: readonly Finding[];
  readonly findingsDigest: string;
  readonly requiredCommands: readonly CommandEvidence[];
  readonly verdict: Verdict;
  readonly authoritative: boolean;
  readonly authorityLimitations: readonly string[];
  readonly artifacts: { readonly sarifDigest: string | null };
}

export interface Rule {
  readonly id: string;
  readonly title: string;
  readonly severity: Severity;
  readonly rationale: string;
  readonly observation: string;
}
