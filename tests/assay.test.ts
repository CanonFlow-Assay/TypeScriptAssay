import { strict as assert } from 'node:assert';
import {
  cpSync,
  existsSync,
  mkdirSync,
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
import { canonicalJson, sha256 } from '../src/canonical.js';
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

test('scoped unresolved-import diagnostics cannot become an authoritative pass', () => {
  const path = copiedFixture('TSA-B01', 'good');
  try {
    writeFileSync(
      resolve(path, 'src/domain/unresolved.ts'),
      "import { missing } from './not-present.js';\nexport const value = missing;\n"
    );
    const result = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(result.verdict.kind, 'ToolFailure');
    assert.equal(result.authoritative, false);
    assert.equal(
      result.authorityLimitations.some((item) => item.includes('TS2307')),
      true
    );
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('selected scoped files excluded from tsconfig cannot become an authoritative pass', () => {
  const path = copiedFixture('TSA-B01', 'good');
  try {
    writeFileSync(resolve(path, 'src/outside.ts'), 'export const outside = 1;\n');
    writeFileSync(
      resolve(path, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true
          },
          include: ['src/outside.ts']
        },
        null,
        2
      )}\n`
    );
    const result = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(result.verdict.kind, 'ToolFailure');
    assert.equal(result.authoritative, false);
    assert.deepEqual(result.scope.unloadedPaths, ['src/adapters/http.ts', 'src/domain/user.ts']);
    assert.equal(result.scope.complete, false);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('receipt binds a resolved tsconfig extends chain and effective compiler options', () => {
  const path = copiedFixture('TSA-B01', 'good');
  try {
    const configDirectory = resolve(path, 'node_modules/@ts-assay/config');
    mkdirSync(configDirectory, { recursive: true });
    writeFileSync(
      resolve(configDirectory, 'package.json'),
      `${JSON.stringify(
        { name: '@ts-assay/config', version: '1.0.0', tsconfig: 'tsconfig.json' },
        null,
        2
      )}\n`
    );
    writeFileSync(
      resolve(configDirectory, 'base.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true
          }
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      resolve(configDirectory, 'tsconfig.json'),
      `${JSON.stringify(
        { extends: './base.json', compilerOptions: { noFallthroughCasesInSwitch: true } },
        null,
        2
      )}\n`
    );
    writeFileSync(
      resolve(path, 'tsconfig.json'),
      `${JSON.stringify({ extends: '@ts-assay/config', include: ['src/**/*.ts'] }, null, 2)}\n`
    );

    const first = evaluate(loadPolicy(path), 'verify', clock).receipt;
    const second = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(first.verdict.kind, 'Pass');
    assert.equal(first.authoritative, true);
    assert.equal(first.projectConfig.complete, true);
    assert.deepEqual(
      first.projectConfig.chain.map((config) => config.path),
      [
        'tsconfig.json',
        'node_modules/@ts-assay/config/tsconfig.json',
        'node_modules/@ts-assay/config/base.json'
      ]
    );
    assert.deepEqual(
      first.projectConfig.chain.map((config) => config.digest),
      first.projectConfig.chain.map((config) => sha256(readFileSync(resolve(path, config.path))))
    );
    assert.match(first.projectConfig.effectiveCompilerOptionsDigest ?? '', /^[a-f0-9]{64}$/);
    assert.equal(
      first.projectConfig.effectiveCompilerOptionsDigest,
      second.projectConfig.effectiveCompilerOptionsDigest
    );
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('a missing extended config is incomplete project evidence and cannot pass', () => {
  const path = copiedFixture('TSA-B01', 'good');
  try {
    writeFileSync(
      resolve(path, 'tsconfig.json'),
      `${JSON.stringify(
        {
          extends: './config/missing.json',
          include: ['src/**/*.ts']
        },
        null,
        2
      )}\n`
    );
    const result = evaluate(loadPolicy(path), 'verify', clock).receipt;
    assert.equal(result.verdict.kind, 'ToolFailure');
    assert.equal(result.authoritative, false);
    assert.equal(result.projectConfig.complete, false);
    assert.deepEqual(
      result.projectConfig.chain.map((config) => config.path),
      ['tsconfig.json', 'config/missing.json']
    );
    assert.equal(result.projectConfig.chain[0]?.digest === null, false);
    assert.equal(result.projectConfig.chain[1]?.digest, null);
    assert.equal(result.projectConfig.effectiveCompilerOptionsDigest, null);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('packed CLI installs into a clean project and runs its public commands', () => {
  const path = mkdtempSync(resolve(tmpdir(), 'ts-assay-package-'));
  try {
    const packedDirectory = resolve(path, 'packed');
    mkdirSync(packedDirectory, { recursive: true });
    const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', packedDirectory], {
      cwd: resolve('.'),
      encoding: 'utf8'
    });
    assert.equal(packed.status, 0, `npm pack failed: ${packed.stderr}`);
    const packageMetadata = JSON.parse(packed.stdout) as readonly {
      readonly filename: string;
      readonly files: readonly { readonly path: string }[];
    }[];
    const packageInfo = packageMetadata[0];
    assert.notEqual(packageInfo, undefined);
    assert.equal(
      packageInfo?.files.some((file) => file.path === 'dist/src/cli.js'),
      true,
      'the packed archive must contain the CLI entry point'
    );
    const tarball = resolve(packedDirectory, packageInfo?.filename ?? 'missing.tgz');
    assert.equal(existsSync(tarball), true);
    assert.match(sha256(readFileSync(tarball)), /^[a-f0-9]{64}$/);

    const project = resolve(path, 'consumer');
    mkdirSync(resolve(project, 'src'), { recursive: true });
    writeFileSync(
      resolve(project, 'package.json'),
      `${JSON.stringify({ name: 'clean-ts-assay-consumer', private: true, type: 'module' }, null, 2)}\n`
    );
    writeFileSync(
      resolve(project, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true
          },
          include: ['src/**/*.ts']
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      resolve(project, '.tsassay.json'),
      `${JSON.stringify(
        {
          schemaVersion: 'ts-assay-policy/0.1',
          profile: 'new',
          domainGlobs: ['src/**/*.ts'],
          boundaryGlobs: [],
          excludedGlobs: [],
          requiredCommands: ['node -e "process.exit(0)"'],
          escapeHatches: {
            assertions: 'forbid',
            nonNullAssertions: 'forbid',
            directives: 'forbid'
          },
          discriminantFields: ['kind', 'type'],
          transportTypeNames: []
        },
        null,
        2
      )}\n`
    );
    writeFileSync(resolve(project, 'src/domain.ts'), 'export const answer = 42;\n');

    const installed = spawnSync('npm', ['install', '--ignore-scripts', tarball], {
      cwd: project,
      encoding: 'utf8'
    });
    assert.equal(installed.status, 0, `tarball install failed: ${installed.stderr}`);

    const cli = resolve(project, 'node_modules/.bin/ts-assay');
    const help = spawnSync(cli, ['--help'], { cwd: project, encoding: 'utf8' });
    assert.equal(help.status, 0, `installed help failed: ${help.stderr}`);
    assert.match(help.stdout, /Usage:/);
    const doctor = spawnSync(cli, ['doctor', '.'], { cwd: project, encoding: 'utf8' });
    assert.equal(doctor.status, 0, `installed doctor failed: ${doctor.stderr}`);
    const doctorReport = JSON.parse(doctor.stdout) as {
      readonly kind: string;
      readonly toolchain: { readonly typescript: string };
    };
    assert.equal(doctorReport.kind, 'Doctor');
    assert.equal(doctorReport.toolchain.typescript, '5.7.3');

    const scan = spawnSync(
      cli,
      ['scan', '.', '--json', 'scan.json', '--sarif', 'scan.sarif', '--clock', clock],
      { cwd: project, encoding: 'utf8' }
    );
    assert.equal(scan.status, 2, `installed scan failed unexpectedly: ${scan.stderr}`);
    const scanReceipt = JSON.parse(readFileSync(resolve(project, 'scan.json'), 'utf8')) as {
      readonly verdict: { readonly kind: string };
      readonly authoritative: boolean;
    };
    assert.equal(scanReceipt.verdict.kind, 'Inconclusive');
    assert.equal(scanReceipt.authoritative, false);

    const verify = spawnSync(
      cli,
      ['verify', '.', '--json', 'verify.json', '--sarif', 'verify.sarif', '--clock', clock],
      { cwd: project, encoding: 'utf8' }
    );
    assert.equal(verify.status, 0, `installed verify failed: ${verify.stderr}`);
    const verifyReceipt = JSON.parse(readFileSync(resolve(project, 'verify.json'), 'utf8')) as {
      readonly verdict: { readonly kind: string };
      readonly authoritative: boolean;
    };
    assert.equal(verifyReceipt.verdict.kind, 'Pass');
    assert.equal(verifyReceipt.authoritative, true);
    assert.equal(existsSync(resolve(project, 'verify.sarif')), true);
  } finally {
    rmSync(path, { recursive: true, force: true });
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
