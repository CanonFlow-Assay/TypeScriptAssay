import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluate } from '../dist/src/evidence.js';
import { loadPolicy } from '../dist/src/policy.js';
import { canonicalJson, sha256 } from '../dist/src/canonical.js';
import { nextInvestigation } from './decision.mjs';
const root = dirname(fileURLToPath(import.meta.url)),
  specimen = resolve(root, 'reservation');
const require = createRequire(import.meta.url),
  compiler = require.resolve('typescript/bin/tsc');
const output = resolve(process.argv[2] ?? resolve(root, '../artifacts/playground-' + Date.now()));
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output, { recursive: false });
const command = (args, cwd) => {
  const run = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024
  });
  return {
    args,
    status:
      run.error || run.signal || run.status === null
        ? 'tool-failure'
        : run.status === 0
          ? 'passed'
          : 'failed',
    exitCode: run.status,
    signal: run.signal,
    stdout: run.stdout,
    stderr: run.stderr,
    outputDigest: sha256((run.stdout ?? '') + (run.stderr ?? ''))
  };
};
const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === 'build'
        ? []
        : files(resolve(directory, entry.name))
      : [resolve(directory, entry.name)]
  );
const snapshot = () =>
  files(specimen)
    .map((file) => ({ path: relative(specimen, file), sha256: sha256(readFileSync(file)) }))
    .sort((a, b) => a.path.localeCompare(b.path));
const beforeSnapshot = snapshot(),
  baseline = evaluate(loadPolicy(specimen), 'verify');
writeFileSync(resolve(output, 'baseline.json'), canonicalJson(baseline.receipt));
writeFileSync(resolve(output, 'baseline.sarif'), canonicalJson(baseline.sarif));
if (baseline.receipt.verdict.kind !== 'Pass') throw new Error('Original baseline did not pass');
const mutations = [
  {
    id: 'zero-boundary',
    from: 'quantity <= 0',
    to: 'quantity < 0',
    expectedBefore: 'Survived',
    expectedAfter: 'Killed',
    probeId: 'zero-boundary'
  },
  {
    id: 'exact-stock',
    from: 'quantity > stock',
    to: 'quantity >= stock',
    expectedBefore: 'Survived',
    expectedAfter: 'Killed'
  },
  {
    id: 'wrong-balance',
    from: 'stock - quantity',
    to: 'stock + quantity',
    expectedBefore: 'Killed',
    expectedAfter: 'Killed'
  },
  {
    id: 'integer-equivalent',
    from: 'quantity <= 0',
    to: 'quantity < 1',
    expectedBefore: 'Survived',
    expectedAfter: 'Survived'
  },
  {
    id: 'invalid-syntax',
    from: 'stock - quantity',
    to: 'stock - )',
    expectedBefore: 'Invalid',
    expectedAfter: 'Invalid'
  }
];
const cases = [];
for (const mutation of mutations) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'ts-assay-mutation-'));
  try {
    cpSync(specimen, temporary, { recursive: true, filter: (file) => !file.includes('/build') });
    const file = resolve(temporary, 'src/domain/reservation.ts'),
      original = readFileSync(file, 'utf8');
    if (original.split(mutation.from).length !== 2)
      throw new Error('Mutation anchor must occur once');
    const changed = original.replace(mutation.from, mutation.to);
    writeFileSync(file, changed);
    const compile = command([compiler, '-p', 'tsconfig.json'], temporary);
    if (compile.status === 'tool-failure') throw new Error('Compiler execution incomplete');
    const valid = compile.status === 'passed';
    const before = valid ? command(['--test', 'tests/baseline.test.js'], temporary) : null;
    const after = valid ? command(['--test', 'tests/expanded.test.js'], temporary) : null;
    if ([before, after].some((run) => run?.status === 'tool-failure'))
      throw new Error('Test execution incomplete');
    const classify = (run) =>
      !valid ? 'Invalid' : run.status === 'passed' ? 'Survived' : 'Killed';
    const beforeStatus = classify(before),
      afterStatus = classify(after);
    cases.push({
      id: mutation.id,
      requirement: 'RES-001',
      originalDigest: sha256(original),
      mutatedDigest: sha256(changed),
      compile,
      before,
      after,
      beforeStatus,
      afterStatus,
      advice: nextInvestigation({
        baselinePassed: true,
        validMutation: valid,
        completed: true,
        survived: beforeStatus === 'Survived',
        budget: 3,
        probeId: mutation.probeId
      }),
      expectationMet:
        beforeStatus === mutation.expectedBefore && afterStatus === mutation.expectedAfter,
      unresolved: afterStatus === 'Survived'
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
const unchanged = canonicalJson(beforeSnapshot) === canonicalJson(snapshot());
const report = {
  schemaVersion: 'ts-assay-playground/0.1',
  toolchain: {
    node: process.version,
    compiler: '5.7.3',
    pinnedAuthoringRuntime: '20.20.2',
    pinnedRuntimeMatched: process.version === 'v20.20.2'
  },
  sourceSnapshot: beforeSnapshot,
  baseline: baseline.receipt.verdict,
  sourceUnchanged: unchanged,
  cases,
  completed: unchanged && cases.every((c) => c.expectationMet),
  survivors: cases.filter((c) => c.unresolved).map((c) => c.id),
  claims:
    'Bounded fixture execution, not universal correctness or automatic survivor equivalence; no model calls or release approval.'
};
writeFileSync(resolve(output, 'mutation-cases.json'), canonicalJson(report));
process.stdout.write(
  canonicalJson({
    output,
    baseline: report.baseline,
    cases: cases.length,
    survivors: report.survivors,
    completed: report.completed,
    pinnedRuntimeMatched: report.toolchain.pinnedRuntimeMatched
  })
);
if (!report.completed) process.exitCode = 1;
