import { spawnSync, execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  readdirSync,
  existsSync,
  lstatSync
} from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const language = pkg.name === 'javascript-assay' ? 'javascript' : 'typescript';
const args = process.argv.slice(2);
const development = args.includes('--development');
const output = resolve(
  args.find((arg) => !arg.startsWith('--')) ?? resolve(root, 'artifacts/lifecycle-' + Date.now())
);
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};
ensure(
  process.version === 'v20.20.2',
  'Run with pinned Node20.20.2 and npm10.8.2 on task-only PATH'
);
ensure(!existsSync(output), 'Choose a fresh lifecycle output directory');
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output);
const steps = [];
const command = (executable, arguments_, cwd = root, allowed = [0]) => {
  const result = spawnSync(executable, arguments_, {
    cwd,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024
  });
  const record = {
    command: [executable, ...arguments_],
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
  steps.push(record);
  ensure(
    !result.error && !result.signal && allowed.includes(result.status),
    'Command failed: ' + record.command.join(' ') + '\n' + record.stderr
  );
  return record;
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shaFile = (file) => hash(readFileSync(file));
const dirty = command('git', ['status', '--porcelain']).stdout.trim();
ensure(development || !dirty, 'Commit producer inputs before packing qualification');
ensure(command('npm', ['--version']).stdout.trim() === '10.8.2', 'Pinned npm10.8.2 is required');
const producer = {
  commit: command('git', ['rev-parse', 'HEAD']).stdout.trim(),
  tree: command('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim(),
  dirty: Boolean(dirty),
  node: process.version,
  npm: '10.8.2'
};
if (language === 'typescript')
  command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
const identity = JSON.parse(readFileSync(resolve(root, 'workflow/engine-identity.json'), 'utf8'));
const actualCatalog = command(process.execPath, [
  '--input-type=module',
  '-e',
  language === 'javascript'
    ? "import {rules} from './src/catalog.js';import {canonical,sha256} from './src/canonical.js';console.log(sha256(canonical(rules)));"
    : "import {ruleCatalogDigest} from './dist/src/catalog.js';console.log(ruleCatalogDigest);"
]).stdout.trim();
ensure(
  actualCatalog === identity.catalogDigest,
  'Committed engine catalog identity differs from built evaluator'
);
const archives = resolve(output, 'archives');
mkdirSync(archives);
const packed = JSON.parse(
  command('npm', [
    'pack',
    '--offline',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    archives
  ]).stdout
)[0];
const archive = resolve(archives, packed.filename),
  archiveSha256 = shaFile(archive);
const consumer = resolve(output, 'consumer');
cpSync(resolve(root, 'playground/application-template'), consumer, { recursive: true });
mkdirSync(resolve(consumer, 'vendor'));
cpSync(archive, resolve(consumer, 'vendor', packed.filename));
command(
  'npm',
  [
    'install',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    './vendor/' + packed.filename
  ],
  consumer
);
const installed = resolve(consumer, 'node_modules', pkg.name);
const payload = packed.files
  .map((file) => {
    ensure(!file.path.includes('..'), 'Invalid archive path');
    const actual = shaFile(resolve(installed, file.path));
    const bytes = execFileSync('tar', ['-xOf', archive, 'package/' + file.path], {
      maxBuffer: 8 * 1024 * 1024
    });
    ensure(hash(bytes) === actual, 'Installed payload differs from archive: ' + file.path);
    return { path: file.path, sha256: actual };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const dependencyFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.name === '.bin' || file === installed) return [];
    ensure(!entry.isSymbolicLink(), 'Linked dependency is unsupported');
    return entry.isDirectory() ? dependencyFiles(file) : [file];
  });
const dependencies = dependencyFiles(resolve(consumer, 'node_modules'))
  .map((file) => ({ path: relative(consumer, file), sha256: shaFile(file) }))
  .sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(
  resolve(consumer, 'toolkit.pin.json'),
  JSON.stringify(
    {
      schema: 'assay-package-pin/0.1',
      name: pkg.name,
      version: pkg.version,
      producer,
      archive: {
        path: 'vendor/' + packed.filename,
        sha256: archiveSha256,
        integrity: packed.integrity
      },
      packageFiles: payload,
      dependencies
    },
    null,
    2
  )
);
const cli = resolve(installed, 'workflow/cli.mjs'),
  manifest = resolve(consumer, 'assay.app.json');
let counter = 0;
const invoke = (action, extra = [], allowed = [0]) => {
  const destination = resolve(output, String(++counter).padStart(2, '0') + '-' + action);
  const execution = command(
    process.execPath,
    [cli, action, '--manifest', manifest, '--output', destination, ...extra],
    consumer,
    allowed
  );
  return { directory: destination, execution, value: JSON.parse(execution.stdout) };
};
const intake = invoke('intake');
const baseline = invoke('verify');
ensure(baseline.value.assessment.status === 'ReadyForReview', 'Baseline must be ready');
const request = {
  schema: 'assay-change-request/0.1',
  id: 'RejectOversizedSku',
  requirement: {
    id: 'RES-003',
    description:
      'Reject SKUs whose trimmed length exceeds12 UTF-16 code units using the existing InvalidInput outcome; preserve shorter SKUs and the wire contract.'
  },
  selection: {
    id: 'RES-003',
    minimum: 1,
    names: ['RES-003 oversized SKU is rejected'],
    files: ['tests/change-RES-003.test.mjs'],
    command: ['node', '--test', '--test-reporter=tap', 'tests/change-RES-003.test.mjs']
  }
};
const requestPath = resolve(output, 'change-request.json');
writeFileSync(requestPath, JSON.stringify(request, null, 2));
const plan = invoke('plan', [
  '--baseline',
  resolve(baseline.directory, 'run.json'),
  '--request',
  requestPath
]);
const app = JSON.parse(readFileSync(manifest, 'utf8'));
app.selections.push(request.selection);
app.files.push(...request.selection.files);
writeFileSync(manifest, JSON.stringify(app, null, 2));
const requirements = JSON.parse(readFileSync(resolve(consumer, 'requirements.json'), 'utf8'));
requirements.requirements.push(request.requirement);
writeFileSync(resolve(consumer, 'requirements.json'), JSON.stringify(requirements, null, 2));
const source = language === 'javascript' ? 'src' : 'build';
writeFileSync(
  resolve(consumer, request.selection.files[0]),
  'import test from "node:test"; import assert from "node:assert/strict"; import {decode} from "../' +
    source +
    '/adapters/decode.js"; test("RES-003 oversized SKU is rejected",()=>{assert.equal(decode({sku:"ABCDEFGHIJKLM",stock:10,quantity:1}).kind,"InvalidInput");assert.equal(decode({sku:"ABCDEFGHIJKL",stock:10,quantity:1}).kind,"Decoded");});\n'
);
const candidateArgs = [
  '--baseline',
  resolve(baseline.directory, 'run.json'),
  '--plan',
  resolve(plan.directory, 'plan.json')
];
const failing = invoke('verify', candidateArgs, [1]);
ensure(failing.value.assessment.status === 'NotReady', 'Retain the real failing acceptance result');
const decoder = resolve(
  consumer,
  'src/adapters/decode.' + (language === 'javascript' ? 'js' : 'ts')
);
const original = readFileSync(decoder, 'utf8');
const anchor = 'sku.trim().length === 0';
ensure(original.split(anchor).length === 2, 'Unique decoder requirement anchor');
writeFileSync(decoder, original.replace(anchor, anchor + ' || sku.trim().length > 12'));
const repairedArgs = [...candidateArgs, '--failure', resolve(failing.directory, 'run.json')];
const repaired = invoke('verify', repairedArgs);
ensure(
  repaired.value.assessment.status === 'ReadyForReview',
  'Repaired candidate must retain original obligations'
);
const probes = [];
for (const id of ['resilience', 'contract', 'contract'])
  probes.push(
    invoke('investigate', ['--run', resolve(repaired.directory, 'run.json'), '--probe', id])
  );
const exhausted = invoke(
  'investigate',
  ['--run', resolve(repaired.directory, 'run.json'), '--probe', 'contract'],
  [2]
);
ensure(exhausted.value.status === 'BudgetExhausted', 'Fourth optional probe must not execute');
const controls = [];
const noFailure = invoke('verify', candidateArgs, [2]);
ensure(
  noFailure.value.assessment.status === 'ContextRequired',
  'Repair without retained failing acceptance cannot be ready'
);
controls.push({ id: 'missing-retained-failing-acceptance', ...noFailure });
const mutate = (id, file, transform, extra = repairedArgs, action = 'verify') => {
  const before = readFileSync(file);
  try {
    writeFileSync(file, transform(before));
    const observed = invoke(action, extra, [2]);
    ensure(
      observed.value.assessment?.status === 'ContextRequired' ||
        observed.value.status === 'ContextRequired',
      id + ' must require context'
    );
    if (id.startsWith('duplicate-'))
      ensure(
        (observed.value.reason ?? observed.value.assessment?.reason ?? '').includes(
          'Duplicate JSON field'
        ),
        'Duplicate-key control must reach strict JSON validation'
      );
    controls.push({ id, ...observed });
  } finally {
    writeFileSync(file, before);
  }
};
mutate('original-test-minimum-lowered', manifest, (bytes) => {
  const value = JSON.parse(bytes);
  value.selections[0].minimum = 13;
  return JSON.stringify(value);
});
mutate(
  'new-acceptance-changed-after-failure',
  resolve(consumer, request.selection.files[0]),
  (bytes) => Buffer.concat([bytes, Buffer.from(' ')])
);
mutate('original-test-source-changed', resolve(consumer, 'tests/original.test.mjs'), (bytes) =>
  Buffer.concat([bytes, Buffer.from('\n// changed frozen test\n')])
);
mutate('contract-pin-changed', resolve(consumer, 'contracts/reservation-v1.json'), (bytes) =>
  Buffer.concat([bytes, Buffer.from(' ')])
);
mutate('archive-changed', resolve(consumer, 'vendor', packed.filename), (bytes) =>
  Buffer.concat([bytes, Buffer.from('changed')])
);
mutate('installed-package-changed', resolve(installed, 'README.md'), (bytes) =>
  Buffer.concat([bytes, Buffer.from('\nchanged')])
);
mutate(
  'compiler-bytes-changed',
  resolve(consumer, 'node_modules/typescript/package.json'),
  (bytes) => Buffer.concat([bytes, Buffer.from(' ')])
);
mutate('original-requirement-dropped', resolve(consumer, 'requirements.json'), (bytes) => {
  const value = JSON.parse(bytes);
  value.requirements.shift();
  return JSON.stringify(value);
});
mutate('baseline-evidence-changed', resolve(baseline.directory, 'run.json'), (bytes) =>
  Buffer.concat([bytes, Buffer.from(' ')])
);
mutate(
  'stale-probe-source',
  decoder,
  (bytes) => Buffer.concat([bytes, Buffer.from('\n// stale source\n')]),
  ['--run', resolve(repaired.directory, 'run.json'), '--probe', 'resilience'],
  'investigate'
);
if (language === 'typescript')
  mutate(
    'stale-built-runtime',
    resolve(consumer, 'build/adapters/decode.js'),
    (bytes) => Buffer.concat([bytes, Buffer.from(' ')]),
    ['--run', resolve(repaired.directory, 'run.json'), '--probe', 'contract'],
    'investigate'
  );
mutate(
  'engine-evidence-changed',
  resolve(repaired.directory, 'engine.json'),
  (bytes) => Buffer.concat([bytes, Buffer.from(' ')]),
  ['--run', resolve(repaired.directory, 'run.json'), '--probe', 'contract'],
  'investigate'
);
const forge = (id, edit) => {
  const target = resolve(output, 'forged-' + id);
  cpSync(failing.directory, target, { recursive: true });
  const file = resolve(target, 'run.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  edit(record, target);
  writeFileSync(file, JSON.stringify(record));
  writeFileSync(resolve(target, 'run.sha256'), shaFile(file) + '\n');
  const observed = invoke('plan', ['--baseline', file, '--request', requestPath], [2]);
  ensure(
    observed.value.status === 'ContextRequired',
    'Forged ' + id + ' cannot establish a baseline'
  );
  ensure(
    (observed.value.reason ?? '').includes(
      id === 'ready-label-with-failed-raw-tests'
        ? 'Ready projection conflicts'
        : 'Named-test projection'
    ),
    'Forgery must be rejected by raw-observation semantic validation'
  );
  controls.push({ id: 'forged-' + id, ...observed });
};
forge('ready-label-with-failed-raw-tests', (record) => {
  record.assessment.status = 'ReadyForReview';
});
forge('test-projection-with-failed-raw-TAP', (record, target) => {
  const file = resolve(target, 'tests.json');
  const tests = JSON.parse(readFileSync(file, 'utf8'));
  tests.find((test) => test.id === 'RES-003').observation.passed = true;
  writeFileSync(file, JSON.stringify(tests));
  record.artifacts.find((artifact) => artifact.path === 'tests.json').sha256 = shaFile(file);
  record.assessment.status = 'ReadyForReview';
});
mutate(
  'duplicate-application-field',
  manifest,
  (bytes) => '{"id":"ambiguous",' + bytes.toString('utf8').slice(1)
);
mutate(
  'duplicate-package-pin-field',
  resolve(consumer, 'toolkit.pin.json'),
  (bytes) => '{"name":"ambiguous",' + bytes.toString('utf8').slice(1)
);
const planFile = resolve(plan.directory, 'plan.json'),
  planDigest = resolve(plan.directory, 'plan.sha256');
const planBytes = readFileSync(planFile),
  planHash = readFileSync(planDigest);
try {
  writeFileSync(planFile, '{"schema":"ambiguous",' + planBytes.toString('utf8').slice(1));
  writeFileSync(planDigest, shaFile(planFile) + '\n');
  const observed = invoke('verify', repairedArgs, [2]);
  ensure(
    observed.value.assessment.status === 'ContextRequired',
    'Duplicate plan fields cannot execute acceptance'
  );
  controls.push({ id: 'duplicate-plan-field', ...observed });
} finally {
  writeFileSync(planFile, planBytes);
  writeFileSync(planDigest, planHash);
}
const { readRun: inspectRun } = await import(
  pathToFileURL(resolve(installed, 'workflow/index.mjs')).href
);
ensure(
  inspectRun(resolve(baseline.directory, 'run.json')).record.assessment.status === 'ReadyForReview',
  'Unchanged original receipt must remain inspectable'
);
const forgeEngine = (id, change) => {
  const target = resolve(output, 'forged-engine-' + id);
  cpSync(baseline.directory, target, { recursive: true });
  const file = resolve(target, 'engine.json');
  const engine = JSON.parse(readFileSync(file, 'utf8'));
  change(engine);
  writeFileSync(file, JSON.stringify(engine));
  const run = JSON.parse(readFileSync(resolve(target, 'run.json'), 'utf8'));
  run.artifacts.find((artifact) => artifact.path === 'engine.json').sha256 = shaFile(file);
  writeFileSync(resolve(target, 'run.json'), JSON.stringify(run));
  writeFileSync(resolve(target, 'run.sha256'), shaFile(resolve(target, 'run.json')) + '\n');
  let rejection = null;
  try {
    inspectRun(resolve(target, 'run.json'));
  } catch (error) {
    rejection = error.message;
  }
  ensure(rejection, 'Engine ' + id + ' must be rejected semantically');
  controls.push({ id: 'forged-engine-' + id, rejected: true, reason: rejection });
};
if (language === 'javascript') {
  forgeEngine('empty-source-map', (engine) => {
    engine.source.files = [];
  });
  forgeEngine('empty-policy-scope', (engine) => {
    engine.scope.domainFiles = [];
    engine.scope.boundaryFiles = [];
    engine.scope.evidenceFiles = [];
  });
  forgeEngine('policy-digest', (engine) => {
    engine.policyDigest = 'f'.repeat(64);
  });
} else {
  forgeEngine('empty-source-scope', (engine) => {
    engine.scope.scannedPaths = [];
    engine.candidate.sourceContentDigest = hash('');
  });
  forgeEngine('policy-digest', (engine) => {
    engine.policy.digest = 'f'.repeat(64);
  });
}
forgeEngine('required-command', (engine) => {
  engine.requiredCommands[0].command =
    language === 'javascript' ? ['node', '-e', 'process.exit(0)'] : 'node -e "process.exit(0)"';
});
forgeEngine('command-exit', (engine) => {
  engine.requiredCommands[0].exitCode = 7;
});
const preparePath = resolve(consumer, 'eng/prepare.mjs'),
  prepareBytes = readFileSync(preparePath);
try {
  writeFileSync(
    preparePath,
    'console.log("PREPARATION-STDOUT-SENTINEL");console.error("PREPARATION-STDERR-SENTINEL");process.exit(7);'
  );
  const incomplete = invoke('verify', [], [2]);
  const reviewed = inspectRun(resolve(incomplete.directory, 'run.json'));
  const execution = JSON.parse(
    readFileSync(resolve(incomplete.directory, 'preparation.json'), 'utf8')
  );
  ensure(
    reviewed.partial &&
      reviewed.record.assessment.status === 'ContextRequired' &&
      execution.exitCode === 7 &&
      execution.stdout.includes('PREPARATION-STDOUT-SENTINEL') &&
      execution.stderr.includes('PREPARATION-STDERR-SENTINEL'),
    'Partial preparation exit/streams must be retained and inspectable'
  );
  controls.push({ id: 'failed-preparation-diagnostics-retained', ...incomplete, inspected: true });
} finally {
  writeFileSync(preparePath, prepareBytes);
}
const unknown = invoke(
  'investigate',
  ['--run', resolve(repaired.directory, 'run.json'), '--probe', 'unregistered'],
  [2]
);
controls.push({ id: 'unregistered-probe', ...unknown });
ensure(unknown.value.executed === false, 'Unknown probe cannot execute');
const forbidden = command(
  process.execPath,
  [
    cli,
    'verify',
    '--manifest',
    manifest,
    '--output',
    resolve(consumer, 'src/domain/unsafe-output')
  ],
  consumer,
  [2]
);
ensure(
  !existsSync(resolve(consumer, 'src/domain/unsafe-output')),
  'Output scope must refuse before creating files'
);
controls.push({ id: 'output-overlaps-source', execution: forbidden });
ensure(shaFile(archive) === archiveSha256, 'Producer archive changed');
ensure(
  dependencies.every((pin) => shaFile(resolve(consumer, pin.path)) === pin.sha256),
  'Dependency bytes changed'
);
const report = {
  schema: 'assay-lifecycle-qualification/0.1',
  language,
  producer,
  archive: { path: archive, sha256: archiveSha256, integrity: packed.integrity },
  consumer: {
    root: consumer,
    installedFromArchive: true,
    sourceProjectReferences: false,
    payloadFiles: payload.length
  },
  intake,
  baseline,
  plan,
  failingAcceptance: failing,
  repairedCandidate: repaired,
  probes,
  exhausted,
  negativeControls: controls,
  completed: true,
  providerRequests: 0,
  claims:
    'Bounded independent local package consumer, requirement loop and controlled HTTP fixture. No release approval, production-provider qualification or universal correctness.'
};
writeFileSync(resolve(output, 'qualification.json'), JSON.stringify(report, null, 2));
writeFileSync(resolve(output, 'commands.json'), JSON.stringify(steps, null, 2));
console.log(
  JSON.stringify({
    output,
    language,
    baseline: baseline.value.assessment.status,
    failingAcceptance: failing.value.assessment.status,
    repairedCandidate: repaired.value.assessment.status,
    probes: probes.length,
    negativeControls: controls.length,
    completed: true
  })
);
