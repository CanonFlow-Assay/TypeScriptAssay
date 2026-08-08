import { strict as assert } from 'node:assert';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { canonicalJson } from '../src/canonical.js';
import { evaluate, toSarif } from '../src/evidence.js';
import { loadPolicy } from '../src/policy.js';

const fixtureRoot = resolve('tests/fixtures/rules');
const clock = '2026-01-02T03:04:05.000Z';
const ruleIds = [
  'TSA-B01',
  'TSA-B02',
  'TSA-B03',
  'TSA-D01',
  'TSA-D02',
  'TSA-D03',
  'TSA-I01',
  'TSA-I02',
  'TSA-E01',
  'TSA-E02',
  'TSA-S01'
];

for (const ruleId of ruleIds) {
  test(`${ruleId} compliant fixture has no finding`, () => {
    const result = evaluate(
      loadPolicy(resolve(fixtureRoot, ruleId, 'good')),
      'scan',
      clock
    ).receipt;
    assert.equal(
      result.findings.some((finding) => finding.ruleId === ruleId),
      false
    );
    assert.notEqual(result.verdict.kind, 'Fail');
    assert.equal(result.authoritative, false);
  });
  test(`${ruleId} failing fixture reports the admitted rule`, () => {
    const result = evaluate(loadPolicy(resolve(fixtureRoot, ruleId, 'bad')), 'scan', clock).receipt;
    assert.equal(
      result.findings.some((finding) => finding.ruleId === ruleId),
      true
    );
    assert.equal(result.verdict.kind, 'Fail');
  });
}

test('verify binds completed required-command evidence and can issue a pass', () => {
  const result = evaluate(
    loadPolicy(resolve(fixtureRoot, 'TSA-B01', 'good')),
    'verify',
    clock
  ).receipt;
  assert.deepEqual(
    result.requiredCommands.map((command) => command.status),
    ['passed']
  );
  assert.equal(result.verdict.kind, 'Pass');
  assert.equal(result.authoritative, true);
});

test('verify never turns failed command evidence into pass', () => {
  const path = copiedFixture('TSA-B01', 'good');
  try {
    const policy = JSON.parse(readFileSync(resolve(path, '.tsassay.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    policy.requiredCommands = ['node -e "process.exit(9)"'];
    writeFileSync(resolve(path, '.tsassay.json'), `${JSON.stringify(policy, null, 2)}\n`);
    const result = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(result.verdict.kind, 'Fail');
    assert.equal(result.authoritative, false);
    assert.equal(result.requiredCommands[0]?.status, 'failed');
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('incomplete scope cannot be authoritative', () => {
  const path = copiedFixture('TSA-B01', 'good');
  try {
    const policy = JSON.parse(readFileSync(resolve(path, '.tsassay.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    policy.domainGlobs = ['src/missing/**/*.ts'];
    writeFileSync(resolve(path, '.tsassay.json'), `${JSON.stringify(policy, null, 2)}\n`);
    const result = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(result.verdict.kind, 'Inconclusive');
    assert.equal(result.authoritative, false);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('verify without a package lock cannot be authoritative', () => {
  const path = copiedFixture('TSA-B01', 'good');
  try {
    unlinkSync(resolve(path, 'package-lock.json'));
    const result = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(result.verdict.kind, 'Inconclusive');
    assert.equal(result.authoritative, false);
    assert.equal(result.packageLockDigest, null);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('converge preserves reviewed debt and blocks a newly introduced finding', () => {
  const path = copiedFixture('TSA-B02', 'bad');
  try {
    const initial = evaluate(loadPolicy(path), 'verify', clock).receipt;
    const existing = initial.findings.find((finding) => finding.ruleId === 'TSA-B02');
    assert.notEqual(existing, undefined);
    const policy = JSON.parse(readFileSync(resolve(path, '.tsassay.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    policy.profile = 'converge';
    policy.baseline = [
      {
        fingerprint: existing?.fingerprint,
        rationale: 'reviewed legacy debt',
        reviewedBy: 'tester',
        reviewedAt: '2026-01-01'
      }
    ];
    writeFileSync(resolve(path, '.tsassay.json'), `${JSON.stringify(policy, null, 2)}\n`);
    const knownOnly = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(knownOnly.findings[0]?.baseline, true);
    assert.equal(knownOnly.verdict.kind, 'Pass');
    writeFileSync(resolve(path, 'src/domain/new-debt.ts'), 'export const second: any = 1;\n');
    const newDebt = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(newDebt.verdict.kind, 'Fail');
    assert.equal(
      newDebt.findings.some((finding) => !finding.baseline),
      true
    );
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('canonical JSON and SARIF are deterministic and source ordered', () => {
  const loaded = loadPolicy(resolve(fixtureRoot, 'TSA-B03', 'bad'));
  const first = evaluate(loaded, 'scan', clock);
  const second = evaluate(loaded, 'scan', clock);
  assert.equal(canonicalJson(first.receipt), canonicalJson(second.receipt));
  assert.equal(canonicalJson(first.sarif), canonicalJson(second.sarif));
  assert.deepEqual(first.sarif, toSarif(loaded.root, first.receipt.findings));
});

test('CLI fixture checks emit a passing receipt and a failing receipt', () => {
  const artifactDirectory = mkdtempSync(resolve(tmpdir(), 'ts-assay-cli-'));
  try {
    const goodReceipt = resolve(artifactDirectory, 'good.json');
    const goodSarif = resolve(artifactDirectory, 'good.sarif');
    const good = runCli('verify', resolve(fixtureRoot, 'TSA-B01', 'good'), goodReceipt, goodSarif);
    assert.equal(good.status, 0, `good fixture stderr: ${good.stderr}`);
    assert.equal(JSON.parse(readFileSync(goodReceipt, 'utf8')).verdict.kind, 'Pass');
    assert.equal(existsSync(goodSarif), true);
    const badReceipt = resolve(artifactDirectory, 'bad.json');
    const badSarif = resolve(artifactDirectory, 'bad.sarif');
    const bad = runCli('scan', resolve(fixtureRoot, 'TSA-B01', 'bad'), badReceipt, badSarif);
    assert.equal(bad.status, 1, `bad fixture stderr: ${bad.stderr}`);
    const receipt = JSON.parse(readFileSync(badReceipt, 'utf8')) as {
      findings: readonly { ruleId: string }[];
    };
    assert.equal(
      receipt.findings.some((finding) => finding.ruleId === 'TSA-B01'),
      true
    );
    assert.equal(existsSync(badSarif), true);
  } finally {
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});

test('CLI invalid policy and missing target cannot pass', () => {
  const path = copiedFixture('TSA-B01', 'good');
  const artifacts = mkdtempSync(resolve(tmpdir(), 'ts-assay-invalid-'));
  try {
    writeFileSync(resolve(path, '.tsassay.json'), '{"profile":"new"}\n');
    const invalidReceipt = resolve(artifacts, 'invalid.json');
    const missingReceipt = resolve(artifacts, 'missing.json');
    assert.equal(
      runCli('verify', path, invalidReceipt, resolve(artifacts, 'invalid.sarif')).status,
      2
    );
    assert.equal(JSON.parse(readFileSync(invalidReceipt, 'utf8')).verdict.kind, 'ToolFailure');
    assert.equal(JSON.parse(readFileSync(invalidReceipt, 'utf8')).authoritative, false);
    assert.equal(
      runCli(
        'verify',
        resolve(path, 'not-here'),
        missingReceipt,
        resolve(artifacts, 'missing.sarif')
      ).status,
      2
    );
    assert.equal(JSON.parse(readFileSync(missingReceipt, 'utf8')).verdict.kind, 'ToolFailure');
  } finally {
    rmSync(path, { recursive: true, force: true });
    rmSync(artifacts, { recursive: true, force: true });
  }
});

test('parser and required-command tool failures are non-authoritative', () => {
  const parserPath = copiedFixture('TSA-B01', 'good');
  const commandPath = copiedFixture('TSA-B01', 'good');
  try {
    writeFileSync(resolve(parserPath, 'src/domain/broken.ts'), 'export const = ;\n');
    const parserResult = evaluate(loadPolicy(parserPath), 'verify', clock).receipt;
    assert.equal(parserResult.verdict.kind, 'ToolFailure');
    assert.equal(parserResult.authoritative, false);
    const policy = JSON.parse(
      readFileSync(resolve(commandPath, '.tsassay.json'), 'utf8')
    ) as Record<string, unknown>;
    policy.requiredCommands = ['not-a-real-ts-assay-command'];
    writeFileSync(resolve(commandPath, '.tsassay.json'), `${JSON.stringify(policy, null, 2)}\n`);
    const commandResult = evaluate(loadPolicy(commandPath), 'verify', clock).receipt;
    assert.equal(commandResult.verdict.kind, 'ToolFailure');
    assert.equal(commandResult.authoritative, false);
  } finally {
    rmSync(parserPath, { recursive: true, force: true });
    rmSync(commandPath, { recursive: true, force: true });
  }
});

const copiedFixture = (rule: string, kind: 'good' | 'bad'): string => {
  const path = mkdtempSync(resolve(tmpdir(), 'ts-assay-test-'));
  cpSync(resolve(fixtureRoot, rule, kind), path, { recursive: true });
  cpSync(resolve('package-lock.json'), resolve(path, 'package-lock.json'));
  return path;
};

const runCli = (mode: 'scan' | 'verify', target: string, json?: string, sarif?: string) =>
  spawnSync(
    process.execPath,
    [
      resolve('dist/src/cli.js'),
      mode,
      target,
      ...(json === undefined ? [] : ['--json', json]),
      ...(sarif === undefined ? [] : ['--sarif', sarif])
    ],
    { encoding: 'utf8' }
  );
