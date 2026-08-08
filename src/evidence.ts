import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { canonicalJson, sha256 } from './canonical.js';
import { ruleCatalogDigest, rules } from './catalog.js';
import { analyze, packageLockDigest, sourceContentDigest } from './analyzer.js';
import type { AnalysisResult, CommandEvidence, Finding, Receipt, Verdict } from './model.js';
import type { LoadedPolicy } from './policy.js';
import { resolveScope } from './scope.js';

const cliVersion = '0.1.0';

export const installedNpmVersion = (): string => {
  try {
    return execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
};

const gitRevision = (root: string): string | null => {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
};

const runCommands = (
  commands: readonly string[],
  root: string,
  execute: boolean
): readonly CommandEvidence[] =>
  commands.map((command) => {
    if (!execute) return { command, status: 'not-run', exitCode: null, outputDigest: null };
    const completed = spawnSync(command, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024
    });
    const output = `${completed.stdout ?? ''}${completed.stderr ?? ''}`;
    if (completed.error !== undefined || completed.status === 127 || completed.status === 9009) {
      return {
        command,
        status: 'tool-failure',
        exitCode: completed.status,
        outputDigest: sha256(output)
      };
    }
    return {
      command,
      status: completed.status === 0 ? 'passed' : 'failed',
      exitCode: completed.status,
      outputDigest: sha256(output)
    };
  });

const blockingFindings = (findings: readonly Finding[]): readonly Finding[] =>
  findings.filter((finding) => finding.severity === 'error' && !finding.baseline);

const decide = (
  mode: 'scan' | 'verify',
  analysis: AnalysisResult,
  commands: readonly CommandEvidence[]
): {
  readonly verdict: Verdict;
  readonly authoritative: boolean;
  readonly limitations: readonly string[];
} => {
  const limitations = [...analysis.analysisLimitations];
  if (analysis.toolFailures.length > 0) {
    limitations.push(...analysis.toolFailures.map((error) => `Analyzer/project failure: ${error}`));
    return {
      verdict: { kind: 'ToolFailure', error: analysis.toolFailures.join('; ') },
      authoritative: false,
      limitations
    };
  }
  if (!analysis.scope.complete) {
    limitations.push(
      'Requested source scope is incomplete: one or more required inclusion globs matched no files.'
    );
    return {
      verdict: {
        kind: 'Inconclusive',
        reason: 'Requested source scope was not completely observed.'
      },
      authoritative: false,
      limitations
    };
  }
  const blocked = blockingFindings(analysis.findings);
  if (blocked.length > 0) {
    limitations.push('Blocking static-policy findings were observed.');
    return { verdict: { kind: 'Fail', findings: blocked }, authoritative: false, limitations };
  }
  const toolFailure = commands.find((command) => command.status === 'tool-failure');
  if (toolFailure !== undefined) {
    limitations.push(`Required command could not be executed: ${toolFailure.command}`);
    return {
      verdict: {
        kind: 'ToolFailure',
        error: `Required command failed to execute: ${toolFailure.command}`
      },
      authoritative: false,
      limitations
    };
  }
  const notRun = commands.filter((command) => command.status === 'not-run');
  if (mode === 'scan' && notRun.length > 0) {
    limitations.push(
      `Required command evidence was not run by scan: ${notRun.map((command) => command.command).join(', ')}`
    );
    return {
      verdict: { kind: 'Inconclusive', reason: 'scan does not execute required command evidence.' },
      authoritative: false,
      limitations
    };
  }
  const failed = commands.filter((command) => command.status === 'failed');
  if (failed.length > 0) {
    if (failed.length > 0)
      limitations.push(
        `Required command failed: ${failed.map((command) => command.command).join(', ')}`
      );
    return { verdict: { kind: 'Fail', findings: blocked }, authoritative: false, limitations };
  }
  if (notRun.length > 0) {
    limitations.push(
      `Required command evidence was not run: ${notRun.map((command) => command.command).join(', ')}`
    );
    return {
      verdict: { kind: 'Inconclusive', reason: 'Required evidence was not run.' },
      authoritative: false,
      limitations
    };
  }
  return { verdict: { kind: 'Pass' }, authoritative: mode === 'verify', limitations };
};

const clock = (controlledClock: string | undefined): string => {
  if (controlledClock !== undefined) return controlledClock;
  const environmentClock = process.env.TS_ASSAY_CLOCK;
  return environmentClock === undefined ? new Date().toISOString() : environmentClock;
};

export const runtimeToolchain = (): Receipt['toolchain'] => ({
  node: process.version,
  packageManager: `npm ${installedNpmVersion()}`,
  typescript: ts.version,
  cli: cliVersion
});

export interface Evaluation {
  readonly receipt: Receipt;
  readonly sarif: Record<string, unknown>;
}

export const evaluate = (
  loaded: LoadedPolicy,
  mode: 'scan' | 'verify',
  controlledClock?: string
): Evaluation => {
  const scope = resolveScope(loaded.root, loaded.policy);
  const analysis = analyze(loaded.root, loaded.policy, scope);
  const commands = runCommands(loaded.policy.requiredCommands, loaded.root, mode === 'verify');
  const decision = decide(mode, analysis, commands);
  const sortedFindings = [...analysis.findings].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.ruleId.localeCompare(right.ruleId)
  );
  const sarif = toSarif(loaded.root, sortedFindings);
  const receipt: Receipt = {
    schemaVersion: 'ts-assay-receipt/0.1',
    mode,
    generatedAt: clock(controlledClock),
    candidate: {
      revision: gitRevision(loaded.root),
      sourceContentDigest: sourceContentDigest(loaded.root, scope.evidence.scannedPaths)
    },
    policy: { profile: loaded.policy.profile, digest: loaded.digest },
    ruleCatalogDigest,
    packageLockDigest: packageLockDigest(loaded.root),
    toolchain: runtimeToolchain(),
    scope: scope.evidence,
    findings: sortedFindings,
    findingsDigest: sha256(canonicalJson(sortedFindings)),
    requiredCommands: commands,
    verdict: decision.verdict,
    authoritative: decision.authoritative,
    authorityLimitations: decision.limitations,
    artifacts: { sarifDigest: sha256(canonicalJson(sarif)) }
  };
  return { receipt, sarif };
};

export const toolFailureEvaluation = (
  mode: 'scan' | 'verify',
  error: string,
  controlledClock?: string
): Evaluation => {
  const sarif = toSarif('', []);
  return {
    receipt: {
      schemaVersion: 'ts-assay-receipt/0.1',
      mode,
      generatedAt: clock(controlledClock),
      candidate: { revision: null, sourceContentDigest: null },
      policy: { profile: null, digest: null },
      ruleCatalogDigest,
      packageLockDigest: null,
      toolchain: runtimeToolchain(),
      scope: {
        scannedPaths: [],
        domainPaths: [],
        boundaryPaths: [],
        excludedPaths: [],
        unmatchedGlobs: [],
        complete: false
      },
      findings: [],
      findingsDigest: sha256(canonicalJson([])),
      requiredCommands: [],
      verdict: { kind: 'ToolFailure', error },
      authoritative: false,
      authorityLimitations: [error],
      artifacts: { sarifDigest: sha256(canonicalJson(sarif)) }
    },
    sarif
  };
};

export const toSarif = (root: string, findings: readonly Finding[]): Record<string, unknown> => ({
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'TypeScriptAssay',
          version: cliVersion,
          informationUri: 'https://github.com/CanonFlow-Assay/TypeScriptAssay',
          rules: rules
            .slice()
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((rule) => ({
              id: rule.id,
              shortDescription: { text: rule.title },
              fullDescription: { text: rule.observation },
              defaultConfiguration: { level: rule.severity === 'error' ? 'error' : 'warning' }
            }))
        }
      },
      results: findings.map((finding) => ({
        ruleId: finding.ruleId,
        level: finding.severity,
        message: { text: finding.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: normalizedUri(root, finding.path) },
              region: { startLine: finding.line, startColumn: finding.column }
            }
          }
        ],
        partialFingerprints: { 'ts-assay/v0.1': finding.fingerprint },
        properties: { baseline: finding.baseline }
      }))
    }
  ]
});

const normalizedUri = (_root: string, path: string): string => path.replaceAll('\\', '/');

export const writeArtifacts = (
  evaluation: Evaluation,
  jsonPath: string,
  sarifPath: string
): void => {
  mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
  mkdirSync(dirname(resolve(sarifPath)), { recursive: true });
  writeFileSync(sarifPath, canonicalJson(evaluation.sarif));
  writeFileSync(jsonPath, canonicalJson(evaluation.receipt));
};

export const artifactHash = (path: string): string | null =>
  existsSync(path) ? sha256(readFileSync(path)) : null;
