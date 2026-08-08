#!/usr/bin/env node
import { resolve } from 'node:path';
import ts from 'typescript';
import { canonicalJson } from './canonical.js';
import { findRule, ruleCatalogDigest } from './catalog.js';
import { evaluate, writeArtifacts } from './evidence.js';
import { loadPolicy } from './policy.js';

interface OutputOptions {
  readonly json: string;
  readonly sarif: string;
  readonly clock: string | undefined;
}

const usage = (): string => `ts-assay 0.1.0

Usage:
  ts-assay doctor [path]
  ts-assay scan <path> [--json <file>] [--sarif <file>] [--clock <ISO-8601>]
  ts-assay verify <path> [--json <file>] [--sarif <file>] [--clock <ISO-8601>]
  ts-assay explain <rule-id>
`;

const parseOutputs = (arguments_: readonly string[]): OutputOptions => {
  let json = 'artifacts/ts-assay-receipt.json';
  let sarif = 'artifacts/ts-assay.sarif';
  let clock: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (
      (option === '--json' || option === '--sarif' || option === '--clock') &&
      value === undefined
    ) {
      throw new Error(`${option} requires a value`);
    }
    if (option === '--json') json = value ?? json;
    if (option === '--sarif') sarif = value ?? sarif;
    if (option === '--clock') clock = value;
    if (
      !['--json', '--sarif', '--clock'].includes(option ?? '') &&
      !['--json', '--sarif', '--clock'].includes(arguments_[index - 1] ?? '')
    ) {
      throw new Error(`Unknown option ${option}`);
    }
  }
  return { json, sarif, clock };
};

const readable = (receipt: ReturnType<typeof evaluate>['receipt']): string => {
  const findingSummary =
    receipt.findings.length === 0 ? 'none' : `${receipt.findings.length} finding(s)`;
  return [
    `TypeScriptAssay ${receipt.mode}`,
    `verdict: ${receipt.verdict.kind}`,
    `authoritative: ${receipt.authoritative}`,
    `scope: ${receipt.scope.scannedPaths.length} scanned, ${receipt.scope.excludedPaths.length} excluded`,
    `findings: ${findingSummary}`,
    ...receipt.findings.map(
      (finding) =>
        `${finding.path}:${finding.line}:${finding.column} ${finding.ruleId} ${finding.message}`
    )
  ].join('\n');
};

const main = (): number => {
  const [command, first, ...remaining] = process.argv.slice(2);
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return 0;
  }
  if (command === 'explain') {
    const rule = first === undefined ? undefined : findRule(first);
    if (rule === undefined) {
      process.stderr.write(`Unknown rule: ${first ?? '(missing)'}\n`);
      return 2;
    }
    process.stdout.write(canonicalJson({ ...rule, ruleCatalogDigest }));
    return 0;
  }
  if (command === 'doctor') {
    const target = first ?? '.';
    try {
      const loaded = loadPolicy(resolve(target));
      process.stdout.write(
        canonicalJson({
          kind: 'Doctor',
          policy: { path: loaded.path, ready: true, digest: loaded.digest },
          toolchain: { node: process.version, typescript: ts.version, cli: '0.1.0' },
          complianceClaim: false
        })
      );
      return 0;
    } catch (error) {
      process.stdout.write(
        canonicalJson({
          kind: 'Doctor',
          policy: { ready: false, error: error instanceof Error ? error.message : String(error) },
          complianceClaim: false
        })
      );
      return 2;
    }
  }
  if (command !== 'scan' && command !== 'verify') {
    process.stderr.write(usage());
    return 2;
  }
  if (first === undefined) {
    process.stderr.write(`${command} requires a target path\n`);
    return 2;
  }
  try {
    const output = parseOutputs(remaining);
    const loaded = loadPolicy(resolve(first));
    const evaluation = evaluate(loaded, command, output.clock);
    writeArtifacts(evaluation, output.json, output.sarif);
    process.stdout.write(
      `${readable(evaluation.receipt)}\njson: ${output.json}\nsarif: ${output.sarif}\n`
    );
    return evaluation.receipt.verdict.kind === 'Pass'
      ? 0
      : evaluation.receipt.verdict.kind === 'Fail'
        ? 1
        : 2;
  } catch (error) {
    process.stderr.write(
      `ToolFailure: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 2;
  }
};

process.exitCode = main();
