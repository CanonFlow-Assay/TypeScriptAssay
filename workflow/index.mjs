import { createHash } from 'node:crypto';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  existsSync,
  realpathSync,
  openSync,
  closeSync,
  unlinkSync
} from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const canonical = (value) =>
  JSON.stringify(
    value,
    (_, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]])
          )
        : item,
    2
  ) + '\n';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => sha(canonical(value));
const decodeUTF8 = (value) =>
  typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
export const parseJSON = (input, name = 'evidence.json') => {
  const text = decodeUTF8(input);
  ensure(
    Buffer.byteLength(text, 'utf8') <= 32 * 1024 * 1024,
    'JSON exceeds the lifecycle evidence limit'
  );
  const value = JSON.parse(text);
  const ast = ts.parseJsonText(name, text);
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set();
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          const key = property.name.text;
          ensure(!names.has(key), 'Duplicate JSON field: ' + key);
          names.add(key);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return value;
};
const json = (file) => parseJSON(readFileSync(file), file);
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};
const within = (root, file) => {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
export const inside = (root, entry) => {
  ensure(
    typeof entry === 'string' &&
      entry.length &&
      !isAbsolute(entry) &&
      !entry.includes('\\') &&
      entry.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Noncanonical declared path'
  );
  const file = resolve(root, entry);
  ensure(within(root, file), 'Path escapes application');
  let current = file;
  while (within(root, current)) {
    if (existsSync(current))
      ensure(!lstatSync(current).isSymbolicLink(), 'Symlink input is unsupported');
    if (current === root) break;
    current = dirname(current);
  }
  ensure(lstatSync(file).isFile(), 'Required input is not a regular file: ' + entry);
  return file;
};
const files = (root) =>
  readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      ensure(!entry.isSymbolicLink(), 'Symlink package payload is unsupported');
      return entry.isDirectory()
        ? files(resolve(root, entry.name)).map((file) => entry.name + '/' + file)
        : [entry.name];
    })
    .sort((a, b) => a.localeCompare(b));
export const parseTap = (output) => {
  const results = [...output.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map((match) => ({
    name: match[2].replace(/ # (SKIP|TODO).*$/, ''),
    passed: match[1] === 'ok' && !/ # (SKIP|TODO)/.test(match[2])
  }));
  const summary = (label) => {
    const matched = [...output.matchAll(new RegExp('^# ' + label + ' (\\d+)$', 'gm'))];
    return matched.length === 1 ? Number(matched[0][1]) : NaN;
  };
  return {
    results,
    count: summary('tests'),
    complete:
      output.includes('TAP version 13') &&
      results.length > 0 &&
      results.length === summary('tests') &&
      new Set(results.map((result) => result.name)).size === results.length &&
      ['fail', 'skipped', 'cancelled'].every((label) => summary(label) === 0) &&
      results.every((result) => result.passed)
  };
};
export const execute = (vector, root) => {
  ensure(
    Array.isArray(vector) &&
      vector.length > 0 &&
      vector[0] === 'node' &&
      vector.every((value) => typeof value === 'string' && value.length),
    'Only declared node argument vectors are supported'
  );
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, vector.slice(1), {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: false,
    detached: process.platform !== 'win32',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (process.platform !== 'win32' && result.pid) {
    try {
      process.kill(-result.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  return {
    command: vector,
    status:
      result.error || result.signal || result.status === null
        ? 'ToolFailure'
        : result.status === 0
          ? 'Passed'
          : 'Failed',
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    outputSha256: sha((result.stdout ?? '') + (result.stderr ?? ''))
  };
};
const executionConsistent = (e) =>
  e &&
  typeof e.stdout === 'string' &&
  typeof e.stderr === 'string' &&
  e.outputSha256 === sha(e.stdout + e.stderr) &&
  e.command?.[0] === 'node' &&
  (e.status === 'Passed'
    ? e.exitCode === 0 && !e.signal && !e.error
    : e.status === 'Failed'
      ? Number.isInteger(e.exitCode) && e.exitCode !== 0 && !e.signal
      : e.status === 'ToolFailure' && (e.exitCode === null || Boolean(e.signal)));
export const loadApplication = (manifestPath) => {
  manifestPath = resolve(manifestPath);
  const root = realpathSync(dirname(manifestPath));
  const manifest = json(inside(root, relative(root, manifestPath)));
  ensure(
    manifest.schema === 'assay-application/0.1' &&
      ['javascript', 'typescript'].includes(manifest.language),
    'Unsupported application schema'
  );
  ensure(
    Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      new Set(manifest.files).size === manifest.files.length,
    'Declare a unique nonempty input scope'
  );
  ensure(
    Array.isArray(manifest.selections) &&
      manifest.selections.length > 0 &&
      new Set(manifest.selections.map((s) => s.id)).size === manifest.selections.length,
    'Declare unique test selections'
  );
  for (const selection of manifest.selections) {
    ensure(
      typeof selection.id === 'string' &&
        selection.id &&
        Number.isSafeInteger(selection.minimum) &&
        selection.minimum > 0 &&
        Array.isArray(selection.names) &&
        selection.names.length >= selection.minimum &&
        new Set(selection.names).size === selection.names.length &&
        Array.isArray(selection.files) &&
        selection.files.length,
      'Invalid named-test obligations'
    );
    for (const file of selection.files)
      ensure(manifest.files.includes(file), 'Test files must be declared');
  }
  ensure(
    Array.isArray(manifest.probes) &&
      manifest.probes.length === 2 &&
      new Set(manifest.probes.map((p) => p.id)).size === 2 &&
      manifest.probes.every(
        (probe) =>
          ['contract', 'resilience'].includes(probe.id) &&
          probe.requirementIds.length > 0 &&
          probe.files.every((file) => manifest.files.includes(file))
      ),
    'Only registered contract/resilience fixture probes are supported'
  );
  const requirements = json(inside(root, 'requirements.json'));
  ensure(
    requirements.schema === 'assay-requirements/0.1' &&
      Array.isArray(requirements.requirements) &&
      requirements.requirements.length > 0 &&
      new Set(requirements.requirements.map((r) => r.id)).size === requirements.requirements.length,
    'Invalid requirement registry'
  );
  const ids = new Set(requirements.requirements.map((r) => r.id));
  ensure(
    manifest.probes.every((p) => p.requirementIds.every((id) => ids.has(id))),
    'Probe requirement is not registered'
  );
  return { root, manifestPath, manifest, requirements };
};
export const snapshot = (app) => {
  const pin = json(inside(app.root, 'toolkit.pin.json'));
  ensure(
    pin.schema === 'assay-package-pin/0.1' &&
      pin.name ===
        (app.manifest.language === 'javascript' ? 'javascript-assay' : 'typescript-assay'),
    'Wrong package pin'
  );
  const archive = inside(app.root, pin.archive.path);
  ensure(sha(readFileSync(archive)) === pin.archive.sha256, 'Package archive changed');
  const installedRoot = resolve(app.root, 'node_modules', pin.name);
  ensure(
    realpathSync(installedRoot) === installedRoot && realpathSync(ownRoot) === installedRoot,
    'Lifecycle must execute from the independently installed package, not a source reference'
  );
  const packageFiles = files(installedRoot).map((file) => ({
    path: file,
    sha256: sha(readFileSync(inside(installedRoot, file)))
  }));
  ensure(digest(packageFiles) === digest(pin.packageFiles), 'Installed package bytes changed');
  const dependencyPaths = (directory) =>
    readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const file = resolve(directory, entry.name);
        if (entry.name === '.bin' || file === installedRoot) return [];
        ensure(!entry.isSymbolicLink(), 'Linked dependency is unsupported');
        return entry.isDirectory() ? dependencyPaths(file) : [relative(app.root, file)];
      })
      .sort((a, b) => a.localeCompare(b));
  ensure(
    digest(dependencyPaths(resolve(app.root, 'node_modules'))) ===
      digest(pin.dependencies.map((item) => item.path)),
    'Installed dependency scope changed'
  );
  const authored = (directory, prefix = '') =>
    readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const name = prefix + entry.name;
        if (!prefix && ['node_modules', 'build', 'vendor', '.git'].includes(entry.name)) return [];
        ensure(!entry.isSymbolicLink(), 'Linked application input is unsupported');
        return entry.isDirectory() ? authored(resolve(directory, entry.name), name + '/') : [name];
      })
      .sort();
  const declared = [
    ...new Set([
      ...app.manifest.files,
      relative(app.root, app.manifestPath),
      'requirements.json',
      'toolkit.pin.json',
      'package.json',
      'package-lock.json'
    ])
  ].sort();
  ensure(
    digest(authored(app.root)) === digest(declared),
    'Authored application files differ from declared scope'
  );
  const dependencies = pin.dependencies.map((item) => ({
    path: item.path,
    sha256: sha(readFileSync(inside(app.root, item.path)))
  }));
  ensure(digest(dependencies) === digest(pin.dependencies), 'Compiler/dependency bytes changed');
  const inputs = [
    ...new Set([
      ...app.manifest.files,
      relative(app.root, app.manifestPath),
      'requirements.json',
      'toolkit.pin.json',
      'package.json',
      'package-lock.json',
      pin.archive.path
    ])
  ]
    .sort()
    .map((file) => ({ path: file, sha256: sha(readFileSync(inside(app.root, file))) }));
  return {
    schema: 'assay-application-snapshot/0.1',
    files: inputs,
    digest: digest(inputs),
    toolkitDigest: digest({ pin, packageFiles, dependencies }),
    producer: pin.producer,
    archiveSha256: pin.archive.sha256,
    node: process.version
  };
};
const runtimeSnapshot = (app) => {
  if (existsSync(resolve(app.root, 'build')))
    ensure(
      digest(
        files(resolve(app.root, 'build'))
          .map((file) => 'build/' + file)
          .sort()
      ) === digest([...(app.manifest.runtimeFiles ?? [])].sort()),
      'Built runtime scope differs from declarations'
    );
  const observed = (app.manifest.runtimeFiles ?? []).map((file) => ({
    path: file,
    sha256: sha(readFileSync(inside(app.root, file)))
  }));
  return { files: observed, digest: digest(observed) };
};
const validateFailure = (app, current, baseline, plan, failure) => {
  ensure(
    failure.record.applicationId === app.manifest.id &&
      failure.record.assessment.status === 'NotReady' &&
      failure.record.assessment.sourceUnchanged === true &&
      failure.record.baselineSha256 === baseline.digest &&
      failure.record.changePlanSha256 === digest(plan),
    'Retained failing acceptance belongs to another change or incomplete execution'
  );
  const observations = json(inside(failure.directory, 'tests.json'));
  const changed = observations.find((selection) => selection.id === plan.request.selection.id);
  ensure(
    changed &&
      changed.execution.status === 'Failed' &&
      changed.observation.results.some(
        (test) => plan.request.selection.names.includes(test.name) && !test.passed
      ) &&
      observations
        .filter((selection) => selection.id !== plan.request.selection.id)
        .every((selection) => selection.observation.passed),
    'Retain a real new-acceptance failure against a passing original selection'
  );
  for (const file of plan.request.selection.files) {
    const before = failure.record.snapshot.files.find((input) => input.path === file);
    const after = current.files.find((input) => input.path === file);
    ensure(
      before && after && before.sha256 === after.sha256,
      'New acceptance test changed after its retained failure'
    );
  }
};
const freshDirectory = (app, output) => {
  output = resolve(output);
  ensure(
    !within(app.root, output) && !within(ownRoot, output),
    'Evidence output must be outside application and toolkit inputs'
  );
  ensure(!existsSync(output), 'Choose a fresh evidence directory');
  let parent = dirname(output);
  while (!existsSync(parent)) parent = dirname(parent);
  ensure(realpathSync(parent) === parent, 'Symlink evidence ancestor is unsupported');
  mkdirSync(output, { recursive: true });
  return output;
};
const write = (file, value) => writeFileSync(file, canonical(value), { flag: 'wx' });
const save = (output, record, artifacts = {}) => {
  for (const [name, value] of Object.entries(artifacts)) write(resolve(output, name), value);
  record.artifacts = [
    ...(record.artifacts ?? []),
    ...Object.keys(artifacts)
      .sort()
      .map((name) => ({ path: name, sha256: sha(readFileSync(resolve(output, name))) }))
  ];
  write(resolve(output, 'run.json'), record);
  writeFileSync(
    resolve(output, 'run.sha256'),
    sha(readFileSync(resolve(output, 'run.json'))) + '\n',
    { flag: 'wx' }
  );
  return record;
};
export const readRun = (file, ancestors = new Set()) => {
  file = resolve(file);
  ensure(
    !ancestors.has(file) && ancestors.size < 8,
    'Cyclic or excessive lifecycle evidence chain'
  );
  const stack = new Set([...ancestors, file]);
  const directory = dirname(file);
  ensure(!lstatSync(file).isSymbolicLink(), 'Symlink evidence is unsupported');
  const bytes = readFileSync(file);
  ensure(
    readFileSync(inside(directory, 'run.sha256'), 'utf8').trim() === sha(bytes),
    'Evidence receipt digest changed'
  );
  const record = parseJSON(bytes, file);
  ensure(
    record.schema === 'assay-application-run/0.1' &&
      record.authority === 'ApplicationReviewOnly' &&
      record.providerRequests === 0 &&
      record.optionalProbeBudget === 3,
    'Unsupported lifecycle receipt or authority'
  );
  const mandatory = [
    'engine.json',
    'engine.sarif',
    'tests.json',
    'contract.json',
    'preparation.json',
    'source-snapshot.json'
  ];
  ensure(
    Array.isArray(record.artifacts) &&
      new Set(record.artifacts.map((artifact) => artifact.path)).size === record.artifacts.length,
    'Lifecycle artifact inventory is malformed'
  );
  for (const artifact of record.artifacts)
    ensure(
      sha(readFileSync(inside(directory, artifact.path))) === artifact.sha256,
      'Evidence artifact changed'
    );
  if (record.partial === true) {
    ensure(
      record.assessment?.status === 'ContextRequired',
      'Partial evidence cannot carry ready authority'
    );
    const artifact = (name) => record.artifacts.some((item) => item.path === name);
    if (artifact('source-snapshot.json')) {
      const captured = json(inside(directory, 'source-snapshot.json'));
      ensure(
        record.snapshot &&
          captured.length === record.snapshot.files.length &&
          digest(record.snapshot.files) === record.snapshot.digest &&
          captured.every((input) => {
            const pin = record.snapshot.files.find((file) => file.path === input.path);
            return pin && sha(Buffer.from(input.contentBase64, 'base64')) === pin.sha256;
          }),
        'Partial source snapshot is inconsistent'
      );
    }
    if (artifact('preparation.json'))
      ensure(
        executionConsistent(json(inside(directory, 'preparation.json'))),
        'Partial preparation streams/exit are inconsistent'
      );
    if (artifact('tests.json'))
      ensure(
        json(inside(directory, 'tests.json')).every((test) => executionConsistent(test.execution)),
        'Partial test execution is inconsistent'
      );
    if (artifact('contract.json'))
      ensure(
        executionConsistent(json(inside(directory, 'contract.json')).execution),
        'Partial contract execution is inconsistent'
      );
    if (artifact('engine-execution.json'))
      ensure(
        executionConsistent(json(inside(directory, 'engine-execution.json'))),
        'Partial engine execution is inconsistent'
      );
    return { record, digest: sha(bytes), directory, partial: true };
  }
  ensure(
    [...mandatory, 'engine-execution.json'].every((name) =>
      record.artifacts.some((artifact) => artifact.path === name)
    ),
    'Required lifecycle artifacts are incomplete'
  );
  const captured = json(inside(directory, 'source-snapshot.json'));
  ensure(
    Array.isArray(captured) && new Set(captured.map((f) => f.path)).size === captured.length,
    'Invalid source snapshot'
  );
  const data = new Map(
    captured.map((input) => {
      const value = Buffer.from(input.contentBase64, 'base64');
      ensure(value.toString('base64') === input.contentBase64, 'Noncanonical captured bytes');
      return [input.path, value];
    })
  );
  ensure(
    record.snapshot &&
      Array.isArray(record.snapshot.files) &&
      new Set(record.snapshot.files.map((f) => f.path)).size === record.snapshot.files.length &&
      record.snapshot.files.length === data.size &&
      record.snapshot.files.every(
        (input) => data.has(input.path) && sha(data.get(input.path)) === input.sha256
      ) &&
      digest(record.snapshot.files) === record.snapshot.digest,
    'Source snapshot does not match its file digest map'
  );
  const manifest = parseJSON(data.get(record.manifestFile)),
    requirements = parseJSON(data.get('requirements.json')),
    pin = parseJSON(data.get('toolkit.pin.json'));
  ensure(
    digest(manifest) === digest(record.manifest) &&
      digest(requirements) === digest(record.requirements) &&
      manifest.id === record.applicationId,
    'Application/requirement projection differs from original bytes'
  );
  ensure(
    record.snapshot.archiveSha256 === pin.archive.sha256 &&
      sha(data.get(pin.archive.path)) === pin.archive.sha256 &&
      record.snapshot.toolkitDigest ===
        digest({ pin, packageFiles: pin.packageFiles, dependencies: pin.dependencies }) &&
      digest(record.snapshot.producer) === digest(pin.producer),
    'Package/compiler/archive snapshot bindings are inconsistent'
  );
  const executionValid = executionConsistent;
  const preparation = json(inside(directory, 'preparation.json'));
  ensure(
    executionValid(preparation) && digest(preparation.command) === digest(manifest.prepareCommand),
    'Preparation evidence is inconsistent'
  );
  const testRecords = json(inside(directory, 'tests.json'));
  ensure(
    Array.isArray(testRecords) &&
      testRecords.length === manifest.selections.length &&
      new Set(testRecords.map((t) => t.id)).size === testRecords.length,
    'Named-test observations are incomplete'
  );
  let testsPassed = true;
  for (const selection of manifest.selections) {
    const test = testRecords.find((item) => item.id === selection.id);
    ensure(
      test &&
        executionValid(test.execution) &&
        digest(test.execution.command) === digest(selection.command),
      'Named-test command differs from its registered selection'
    );
    const actual = obligation(test.execution, selection);
    ensure(
      digest(actual) === digest(test.observation),
      'Named-test projection differs from raw TAP'
    );
    testsPassed = testsPassed && actual.passed;
  }
  const contract = json(inside(directory, 'contract.json')),
    contractProbe = manifest.probes.find((p) => p.id === 'contract');
  ensure(
    contractProbe &&
      executionValid(contract.execution) &&
      digest(contract.execution.command) === digest(contractProbe.command) &&
      digest(contract.observation) === digest(obligation(contract.execution, contractProbe)),
    'Contract projection differs from registered raw observations'
  );
  const engine = json(inside(directory, 'engine.json')),
    engineExecution = json(inside(directory, 'engine-execution.json'));
  ensure(
    executionValid(engineExecution) &&
      engine.mode === 'verify' &&
      ['Pass', 'Fail', 'Inconclusive', 'ToolFailure'].includes(engine.verdict?.kind),
    'Engine observation is not a verification receipt'
  );
  ensure(
    digest(record.assessment.engineVerdict) === digest(engine.verdict),
    'Assessment engine verdict differs from its original receipt'
  );
  if (engine.artifacts?.sarifDigest)
    ensure(
      sha(readFileSync(inside(directory, 'engine.sarif'))) === engine.artifacts.sarifDigest,
      'Engine SARIF companion differs from original receipt'
    );
  const scopeFiles = record.snapshot.files;
  const pinFor = (entry) => scopeFiles.find((input) => input.path === entry);
  const policyBytes = data.get(manifest.policy);
  ensure(policyBytes, 'Captured policy is missing');
  const policy = parseJSON(policyBytes);
  const identity = json(resolve(ownRoot, 'workflow/engine-identity.json'));
  ensure(
    engine.toolchain.node === record.snapshot.node &&
      engine.toolchain.typescript === identity.typescript,
    'Engine runtime/compiler identity differs from its snapshot'
  );
  const expectedCommands =
    manifest.language === 'typescript'
      ? [...policy.requiredCommands].sort((a, b) => a.localeCompare(b))
      : policy.requiredCommands;
  ensure(
    Array.isArray(engine.requiredCommands) &&
      engine.requiredCommands.length === expectedCommands.length &&
      engine.requiredCommands.every(
        (command, index) =>
          digest(command.command) === digest(expectedCommands[index]) &&
          (command.status !== 'passed' ||
            (command.exitCode === 0 &&
              !command.signal &&
              /^[a-f0-9]{64}$/.test(command.outputDigest)))
      ),
    'Engine required-command identity or exit evidence differs from captured policy'
  );
  ensure(
    Array.isArray(engineExecution.command) &&
      digest(engineExecution.command.slice(0, 5)) ===
        digest([
          'node',
          resolve(
            record.applicationRoot,
            'node_modules',
            pin.name,
            manifest.language === 'javascript' ? 'src/cli.js' : 'dist/src/cli.js'
          ),
          'verify',
          record.applicationRoot,
          '--json'
        ]) &&
      engineExecution.command[6] === '--sarif' &&
      engineExecution.command.length === 8,
    'Engine executable/target/operation was not the registered verifier'
  );
  if (manifest.language === 'javascript') {
    ensure(
      policy.schemaVersion === 'js-assay-policy/0.1' &&
        manifest.policy === '.jsassay.json' &&
        policy.domainFiles.length > 0,
      'Unsupported JavaScript application policy'
    );
    const paths = [
      ...new Set([
        ...policy.domainFiles,
        ...policy.boundaryFiles,
        ...policy.evidenceFiles,
        '.jsassay.json',
        'package.json',
        'package-lock.json'
      ])
    ].sort();
    const expected = paths.map((path) => {
      ensure(data.has(path), 'Policy source/evidence was not captured');
      return { path, sha256: sha(data.get(path)) };
    });
    ensure(
      engine.schemaVersion === 'js-assay-receipt/0.1' &&
        digest(engine.source.files) === digest(expected) &&
        engine.source.missing.length === 0 &&
        engine.source.digest === digest({ files: expected, missing: [] }) &&
        engine.freshness.unchanged === true &&
        engine.freshness.before === engine.source.digest &&
        engine.freshness.after === engine.source.digest,
      'Engine source scope/digest differs from exact captured policy'
    );
    ensure(
      digest(engine.scope.domainFiles) === digest(policy.domainFiles) &&
        digest(engine.scope.boundaryFiles) === digest(policy.boundaryFiles) &&
        digest(engine.scope.evidenceFiles) === digest(policy.evidenceFiles) &&
        engine.scope.complete === true &&
        engine.scope.missing.length === 0 &&
        engine.scope.unsupported.length === 0 &&
        engine.errors.length === 0,
      'Engine scope/completeness projection differs from captured policy'
    );
    const sources = [...policy.domainFiles, ...policy.boundaryFiles].sort();
    ensure(
      engine.syntax.length === sources.length &&
        engine.syntax.every(
          (syntax, index) =>
            syntax.path === sources[index] &&
            digest(syntax.command) === digest(['node', '--check', sources[index]]) &&
            syntax.status === 'passed' &&
            syntax.exitCode === 0 &&
            !syntax.signal
        ),
      'Engine syntax observations are incomplete'
    );
    ensure(
      engine.policyDigest === sha(policyBytes) && engine.catalogDigest === identity.catalogDigest,
      'Engine policy/catalog digest differs from original input'
    );
    ensure(
      digest(parseJSON(engineExecution.stdout)) === digest(engine),
      'Original engine stdout and receipt artifact disagree'
    );
  } else {
    ensure(
      policy.schemaVersion === 'ts-assay-policy/0.1' && manifest.policy === '.tsassay.json',
      'Unsupported TypeScript application policy'
    );
    const require = createRequire(import.meta.url),
      match = createRequire(require.resolve('fast-glob/package.json'))('micromatch');
    const candidates = [...data.keys()].filter((path) => /\.tsx?$/.test(path));
    const matches = (pattern) => {
      ensure(
        !pattern.startsWith('!'),
        'Negative include patterns require separate workflow qualification'
      );
      return match(candidates, pattern);
    };
    const sorted = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
    const excluded = sorted((policy.excludedGlobs ?? []).flatMap(matches)),
      exclude = new Set(excluded);
    const domains = sorted(
        policy.domainGlobs.flatMap(matches).filter((path) => !exclude.has(path))
      ),
      boundaries = sorted(
        (policy.boundaryGlobs ?? []).flatMap(matches).filter((path) => !exclude.has(path))
      ),
      paths = sorted([...domains, ...boundaries]);
    const unmatched = sorted(
      [
        ...policy.domainGlobs,
        ...(policy.boundaryGlobs ?? []),
        ...(policy.excludedGlobs ?? [])
      ].filter((pattern) => matches(pattern).length === 0)
    );
    ensure(
      domains.length > 0 &&
        paths.length > 0 &&
        engine.schemaVersion === 'ts-assay-receipt/0.1' &&
        digest(engine.scope.scannedPaths) === digest(paths) &&
        digest(engine.scope.domainPaths) === digest(domains) &&
        digest(engine.scope.boundaryPaths) === digest(boundaries) &&
        digest(engine.scope.excludedPaths) === digest(excluded) &&
        digest(engine.scope.unmatchedGlobs) === digest(unmatched) &&
        engine.scope.unloadedPaths.length === 0 &&
        engine.scope.complete === true,
      'Engine scope differs from captured policy'
    );
    const expected = sha(
      paths.map((entry) => entry + '\u0000' + data.get(entry).toString('utf8')).join('\u0000')
    );
    ensure(
      engine.candidate.sourceContentDigest === expected,
      'Engine source digest differs from captured bytes'
    );
    const normalize = (value) =>
      Array.isArray(value)
        ? value.map(normalize)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, normalize(item)])
            )
          : value;
    const tsDigest = (value) => sha(JSON.stringify(normalize(value), null, 2) + '\n');
    const stringSort = (values) => [...values].sort((a, b) => a.localeCompare(b));
    const effectivePolicy = {
      schemaVersion: policy.schemaVersion,
      profile: policy.profile,
      domainGlobs: stringSort(policy.domainGlobs),
      boundaryGlobs: stringSort(policy.boundaryGlobs ?? []),
      excludedGlobs: stringSort(policy.excludedGlobs ?? []),
      requiredCommands: stringSort(policy.requiredCommands),
      escapeHatches: policy.escapeHatches,
      discriminantFields: stringSort(policy.discriminantFields ?? ['kind', 'type']),
      transportTypeNames: stringSort(policy.transportTypeNames ?? []),
      baseline: (policy.baseline ?? [])
        .map((item) => ({
          fingerprint: item.fingerprint,
          rationale: item.rationale,
          reviewedBy: item.reviewedBy,
          reviewedAt: item.reviewedAt
        }))
        .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
    };
    ensure(
      engine.policy.digest === tsDigest(effectivePolicy) &&
        engine.policy.profile === policy.profile &&
        engine.packageLockDigest === sha(data.get('package-lock.json')) &&
        engine.ruleCatalogDigest === identity.catalogDigest,
      'Engine policy/lock/catalog identity differs from captured input'
    );
    ensure(
      engine.projectConfig.complete &&
        engine.projectConfig.chain.length > 0 &&
        engine.projectConfig.chain.every((config) => pinFor(config.path)?.sha256 === config.digest),
      'Engine compiler configuration differs from captured input'
    );
    const rootConfig = resolve(record.applicationRoot, 'tsconfig.json');
    const host = {
      useCaseSensitiveFileNames: true,
      fileExists: (file) => data.has(relative(record.applicationRoot, resolve(file))),
      readFile: (file) => {
        const value = data.get(relative(record.applicationRoot, resolve(file)));
        return value === undefined ? undefined : decodeUTF8(value);
      },
      readDirectory: () => candidates.map((file) => resolve(record.applicationRoot, file))
    };
    const source = ts.parseJsonText(rootConfig, decodeUTF8(data.get('tsconfig.json')));
    const configured = ts.parseJsonSourceFileConfigFileContent(
      source,
      host,
      record.applicationRoot,
      undefined,
      rootConfig
    );
    ensure(
      configured.errors.length === 0 &&
        tsDigest(configured.options) === engine.projectConfig.effectiveCompilerOptionsDigest,
      'Engine effective compiler options differ from captured configuration'
    );
  }
  ensure(
    record.runtime &&
      digest(record.runtime.files) === record.runtime.digest &&
      digest(record.runtime.files.map((f) => f.path).sort()) ===
        digest([...(manifest.runtimeFiles ?? [])].sort()),
    'Runtime artifact map is inconsistent'
  );
  if (manifest.language === 'typescript' && preparation.status === 'Passed') {
    const compilation = parseJSON(preparation.stdout);
    const dependency = (file) =>
      pin.dependencies.find((item) => item.path === 'node_modules/typescript/' + file)?.sha256;
    const runtime = (file) => record.runtime.files.find((item) => item.path === file)?.sha256;
    ensure(
      compilation.typescript === '5.7.3' &&
        compilation.driverSha256 === dependency('lib/tsc.js') &&
        compilation.implementationSha256 === dependency('lib/typescript.js') &&
        compilation.domainSourceSha256 === pinFor('src/domain/reservation.ts')?.sha256 &&
        compilation.decoderSourceSha256 === pinFor('src/adapters/decode.ts')?.sha256 &&
        compilation.domainBinarySha256 === runtime('build/domain/reservation.js') &&
        compilation.decoderBinarySha256 === runtime('build/adapters/decode.js') &&
        compilation.stockClientBinarySha256 === runtime('build/adapters/stock-client.js') &&
        sha(JSON.stringify(compilation)) === runtime('build/compilation.json'),
      'Compiler/source/emission evidence is inconsistent'
    );
  }
  const after = record.afterSnapshot;
  ensure(
    after &&
      digest(after.files) === after.digest &&
      record.afterRuntime &&
      digest(record.afterRuntime.files) === record.afterRuntime.digest,
    'Final source/runtime observation maps are inconsistent'
  );
  const fresh =
    after &&
    after.digest === record.snapshot.digest &&
    after.toolkitDigest === record.snapshot.toolkitDigest &&
    record.afterRuntime?.digest === record.runtime.digest;
  ensure(
    record.assessment.sourceUnchanged === Boolean(fresh),
    'Freshness projection differs from observed snapshots'
  );
  const enginePassed =
    engineExecution.status === 'Passed' &&
    engine.verdict.kind === 'Pass' &&
    engine.scope.complete === true &&
    engine.requiredCommands.length > 0 &&
    engine.requiredCommands.every((command) => command.status === 'passed') &&
    !engine.findings.some((finding) => finding.severity === 'error' && !finding.baseline) &&
    (engine.authoritative === true || engine.authority?.authoritative === true);
  const complete =
    preparation.status === 'Passed' &&
    testsPassed &&
    contract.observation.passed &&
    enginePassed &&
    fresh;
  const observed = { record, digest: sha(bytes), directory };
  if (record.assessment.status === 'ReadyForReview')
    ensure(complete, 'Ready projection conflicts with failed/incomplete raw evidence');
  if (record.baselineSha256) {
    ensure(record.baselinePath && record.changePlanPath, 'Candidate lineage is missing');
    const baseline = readRun(record.baselinePath, stack),
      plan = readPlan(record.changePlanPath);
    ensure(
      baseline.digest === record.baselineSha256 &&
        sha(readFileSync(record.changePlanPath)) === record.changePlanSha256,
      'Candidate lineage digests changed'
    );
    validateFrozen({ manifest, requirements }, record.snapshot, baseline, plan);
    if (record.failingAcceptanceSha256) {
      ensure(record.failingAcceptancePath, 'Failing acceptance path is missing');
      const failed = readRun(record.failingAcceptancePath, stack);
      ensure(
        failed.digest === record.failingAcceptanceSha256,
        'Retained failing acceptance changed'
      );
      validateFailure({ manifest, requirements }, record.snapshot, baseline, plan, failed);
    } else
      ensure(
        record.assessment.status !== 'ReadyForReview',
        'Ready candidate lacks a retained failing acceptance'
      );
  }
  if (record.assessment.status === 'ReadyForReview')
    ensure(complete, 'Ready projection conflicts with failed/incomplete raw evidence');
  if (record.assessment.status === 'NotReady')
    ensure(!complete, 'NotReady projection conflicts with complete raw evidence');
  ensure(
    ['ReadyForReview', 'NotReady', 'ContextRequired'].includes(record.assessment.status),
    'Unknown application assessment state'
  );
  return observed;
};
const obligation = (result, selection) => {
  const tap = parseTap(result.stdout);
  return {
    ...tap,
    passed:
      result.status === 'Passed' &&
      tap.complete &&
      tap.count >= selection.minimum &&
      selection.names.every((name) => tap.results.some((item) => item.name === name && item.passed))
  };
};
const validateFrozen = (app, current, baseline, plan) => {
  ensure(
    baseline.record.assessment.status === 'ReadyForReview' &&
      baseline.record.applicationId === app.manifest.id,
    'Original baseline was not ready for this application'
  );
  ensure(
    current.toolkitDigest === baseline.record.snapshot.toolkitDigest &&
      current.node === baseline.record.snapshot.node,
    'Frozen package/compiler/runtime identity changed'
  );
  for (const old of baseline.record.manifest.selections)
    ensure(
      app.manifest.selections.some((now) => digest(now) === digest(old)),
      'Original named-test selection/minimum changed'
    );
  ensure(
    digest(app.manifest.probes) === digest(baseline.record.manifest.probes),
    'Registered probe contract changed'
  );
  ensure(
    digest(app.manifest.prepareCommand) === digest(baseline.record.manifest.prepareCommand) &&
      app.manifest.policy === baseline.record.manifest.policy &&
      app.manifest.contract === baseline.record.manifest.contract,
    'Preparation/policy/contract declaration changed'
  );
  const frozen = [
    ...baseline.record.manifest.selections.flatMap((selection) => selection.files),
    ...baseline.record.manifest.probes.flatMap((probe) => probe.files),
    'eng/test.mjs',
    'eng/prepare.mjs',
    'package.json',
    'package-lock.json',
    'toolkit.pin.json',
    baseline.record.manifest.policy,
    ...(baseline.record.manifest.files.includes('tsconfig.json') ? ['tsconfig.json'] : []),
    baseline.record.manifest.contract
  ];
  for (const file of new Set(frozen)) {
    const before = baseline.record.snapshot.files.find((item) => item.path === file);
    const after = current.files.find((item) => item.path === file);
    ensure(
      before && after && before.sha256 === after.sha256,
      'Frozen test/contract input changed: ' + file
    );
  }
  ensure(
    plan &&
      plan.schema === 'assay-change-plan/0.1' &&
      plan.baselineSha256 === baseline.digest &&
      plan.sourceDigest === baseline.record.snapshot.digest,
    'A source-bound change plan is required'
  );
  ensure(plan.applicationId === app.manifest.id, 'Change plan targets another application');
  const expected = [...baseline.record.requirements.requirements, plan.request.requirement];
  ensure(
    digest(app.requirements.requirements) === digest(expected),
    'Original requirements changed or planned requirement missing'
  );
  ensure(
    app.manifest.selections.length === baseline.record.manifest.selections.length + 1 &&
      app.manifest.selections.some(
        (selection) => digest(selection) === digest(plan.request.selection)
      ),
    'New acceptance obligation differs from registered change'
  );
};
export const intake = (manifestPath, output) => {
  const app = loadApplication(manifestPath),
    state = snapshot(app);
  output = freshDirectory(app, output);
  return save(output, {
    schema: 'assay-application-intake/0.1',
    applicationId: app.manifest.id,
    snapshot: state,
    requirements: app.requirements,
    status: 'IntakeRecorded',
    authority: 'NoVerificationGrant'
  });
};
export const planChange = (manifestPath, baselinePath, requestPath, output) => {
  const app = loadApplication(manifestPath),
    state = snapshot(app),
    baseline = readRun(baselinePath),
    request = json(resolve(requestPath));
  ensure(
    baseline.record.assessment.status === 'ReadyForReview' &&
      state.digest === baseline.record.snapshot.digest,
    'Planning requires the unchanged ready original baseline'
  );
  ensure(
    request.schema === 'assay-change-request/0.1' &&
      typeof request.id === 'string' &&
      request.id &&
      request.requirement?.id &&
      request.requirement.description &&
      !app.requirements.requirements.some((r) => r.id === request.requirement.id),
    'Invalid named change request'
  );
  ensure(
    request.selection?.id === request.requirement.id &&
      request.selection.minimum > 0 &&
      request.selection.names.length >= request.selection.minimum &&
      request.selection.files.length > 0,
    'Change must register named acceptance obligations'
  );
  output = freshDirectory(app, output);
  const plan = {
    schema: 'assay-change-plan/0.1',
    applicationId: app.manifest.id,
    baselineSha256: baseline.digest,
    sourceDigest: state.digest,
    request,
    requestSha256: sha(readFileSync(resolve(requestPath))),
    authority: 'WorkItemOnly',
    obligations: [
      'Retain frozen original test files, names and minima',
      'Retain the original wire contract and registered probe scripts',
      'Retain a failing acceptance run before the repair',
      'Preserve package/compiler/archive identities and source freshness'
    ]
  };
  write(resolve(output, 'plan.json'), plan);
  writeFileSync(
    resolve(output, 'plan.sha256'),
    sha(readFileSync(resolve(output, 'plan.json'))) + '\n',
    { flag: 'wx' }
  );
  return plan;
};
const readPlan = (file) => {
  ensure(
    readFileSync(resolve(dirname(file), 'plan.sha256'), 'utf8').trim() === sha(readFileSync(file)),
    'Change plan changed'
  );
  return json(file);
};
export const verifyApplication = (manifestPath, output, options = {}) => {
  const app = loadApplication(manifestPath);
  output = freshDirectory(app, output);
  let before, baseline, plan, failure;
  const retained = {};
  let observedEngine = null;
  const base = {
    schema: 'assay-application-run/0.1',
    applicationId: app.manifest.id,
    applicationRoot: app.root,
    optionalProbeBudget: 3,
    manifestFile: relative(app.root, app.manifestPath),
    manifest: app.manifest,
    requirements: app.requirements,
    authority: 'ApplicationReviewOnly',
    providerRequests: 0,
    limitations: [
      'Engine receipt retains its original scoped authority.',
      'Named tests/fixture probes do not establish complete business correctness, general compatibility, real provider reliability or release approval.',
      'Local hashes are integrity bindings, not independent attestations.'
    ]
  };
  try {
    before = snapshot(app);
    if (options.baseline) {
      baseline = readRun(options.baseline);
      plan = readPlan(resolve(options.plan));
      validateFrozen(app, before, baseline, plan);
      if (options.failure) {
        failure = readRun(options.failure);
        validateFailure(app, before, baseline, plan, failure);
      }
    }
    const sourceSnapshot = before.files.map((input) => {
      const bytes = readFileSync(inside(app.root, input.path));
      ensure(sha(bytes) === input.sha256, 'Input changed while capturing frozen bytes');
      return { path: input.path, contentBase64: bytes.toString('base64') };
    });
    retained['source-snapshot.json'] = sourceSnapshot;
    const preparation = execute(app.manifest.prepareCommand, app.root);
    retained['preparation.json'] = preparation;
    ensure(preparation.status === 'Passed', 'Application preparation did not complete');
    const runtime = runtimeSnapshot(app);
    const selections = [];
    retained['tests.json'] = selections;
    for (const selection of app.manifest.selections) {
      const execution = execute(selection.command, app.root);
      const item = { id: selection.id, execution };
      selections.push(item);
      item.observation = obligation(execution, selection);
    }
    const contract = app.manifest.probes.find((probe) => probe.id === 'contract');
    const contractExecution = execute(contract.command, app.root);
    retained['contract.json'] = { execution: contractExecution };
    const contractObservation = obligation(contractExecution, contract);
    retained['contract.json'].observation = contractObservation;
    const pin = json(inside(app.root, 'toolkit.pin.json'));
    const cli = resolve(
      app.root,
      'node_modules',
      pin.name,
      app.manifest.language === 'javascript' ? 'src/cli.js' : 'dist/src/cli.js'
    );
    const engineJson = resolve(output, 'engine.json'),
      engineSarif = resolve(output, 'engine.sarif');
    const engineExecution = execute(
      ['node', cli, 'verify', app.root, '--json', engineJson, '--sarif', engineSarif],
      app.root
    );
    retained['engine-execution.json'] = engineExecution;
    const engine = json(engineJson),
      after = snapshot(loadApplication(manifestPath));
    observedEngine = engine;
    const unchanged =
      before.digest === after.digest &&
      before.toolkitDigest === after.toolkitDigest &&
      runtime.digest === runtimeSnapshot(app).digest;
    const complete =
      unchanged &&
      selections.every((selection) => selection.observation.passed) &&
      contractObservation.passed &&
      engineExecution.status === 'Passed' &&
      engine.verdict?.kind === 'Pass' &&
      (engine.authoritative === true || engine.authority?.authoritative === true);
    const record = {
      ...base,
      snapshot: before,
      afterSnapshot: after,
      runtime,
      afterRuntime: runtimeSnapshot(app),
      baselinePath: options.baseline ? resolve(options.baseline) : null,
      changePlanPath: options.plan ? resolve(options.plan) : null,
      failingAcceptancePath: options.failure ? resolve(options.failure) : null,
      failingAcceptanceSha256: failure?.digest ?? null,
      baselineSha256: baseline?.digest ?? null,
      changePlanSha256: options.plan ? sha(readFileSync(options.plan)) : null,
      assessment: {
        status:
          !unchanged || (complete && baseline && !failure)
            ? 'ContextRequired'
            : complete
              ? 'ReadyForReview'
              : 'NotReady',
        reason:
          complete && baseline && !failure
            ? 'A retained real failing acceptance run is required before repair acceptance'
            : null,
        engineVerdict: engine.verdict,
        sourceUnchanged: unchanged,
        oldNamedTestsRetained: true,
        contractPin: before.files.find((item) => item.path === app.manifest.contract)?.sha256
      },
      optionalProbeBudget: 3
    };
    // Raw engine evidence is already present; retain it through hashes alongside execution logs.
    const artifacts = retained;
    record.artifacts = ['engine.json', 'engine.sarif'].map((file) => ({
      path: file,
      sha256: sha(readFileSync(resolve(output, file)))
    }));
    save(output, record, artifacts);
    write(resolve(output, 'probe-budget.json'), {
      schema: 'assay-probe-budget/0.1',
      runSha256: sha(readFileSync(resolve(output, 'run.json'))),
      used: 0,
      limit: 3
    });
    return record;
  } catch (error) {
    const existing = ['engine.json', 'engine.sarif']
      .filter((file) => existsSync(resolve(output, file)))
      .map((file) => ({ path: file, sha256: sha(readFileSync(resolve(output, file))) }));
    return save(
      output,
      {
        ...base,
        partial: true,
        snapshot: before ?? null,
        artifacts: existing,
        assessment: {
          status: 'ContextRequired',
          reason: error.message,
          engineVerdict: observedEngine?.verdict ?? null
        }
      },
      retained
    );
  }
};
export const investigate = (manifestPath, runPath, probeId, output) => {
  const app = loadApplication(manifestPath),
    run = readRun(runPath),
    current = snapshot(app);
  ensure(
    run.record.assessment.status === 'ReadyForReview',
    'Only a completed ready snapshot is eligible for optional investigation'
  );
  ensure(
    run.record.snapshot &&
      current.digest === run.record.snapshot.digest &&
      current.toolkitDigest === run.record.snapshot.toolkitDigest,
    'Investigation evidence is stale'
  );
  ensure(
    run.record.runtime && runtimeSnapshot(app).digest === run.record.runtime.digest,
    'Built runtime artifact changed after assessment'
  );
  const probe = app.manifest.probes.find((item) => item.id === probeId);
  ensure(
    probe && digest(app.manifest.probes) === digest(run.record.manifest.probes),
    'Investigation is not registered on this snapshot'
  );
  const lock = resolve(run.directory, 'probe-budget.lock');
  let descriptor;
  try {
    descriptor = openSync(lock, 'wx');
  } catch {
    throw new Error('Investigation budget is locked; no request executed');
  }
  try {
    const budgetPath = inside(run.directory, 'probe-budget.json'),
      budget = json(budgetPath);
    ensure(
      budget.runSha256 === run.digest &&
        budget.limit === 3 &&
        Number.isSafeInteger(budget.used) &&
        budget.used >= 0,
      'Probe budget is malformed'
    );
    if (budget.used >= budget.limit)
      return {
        schema: 'assay-investigation/0.1',
        status: 'BudgetExhausted',
        authority: 'AdvisoryOnly',
        executed: false
      };
    output = freshDirectory(app, output);
    budget.used += 1;
    writeFileSync(budgetPath, canonical(budget));
    const beforeRuntime = runtimeSnapshot(app);
    const execution = execute(probe.command, app.root),
      observation = obligation(execution, probe),
      after = snapshot(loadApplication(manifestPath));
    const record = {
      schema: 'assay-investigation/0.1',
      probeId,
      runSha256: run.digest,
      sourceDigest: current.digest,
      status:
        after.digest !== current.digest ||
        after.toolkitDigest !== current.toolkitDigest ||
        runtimeSnapshot(app).digest !== beforeRuntime.digest
          ? 'ContextRequired'
          : observation.passed
            ? 'ObservedPass'
            : 'ObservedFailure',
      authority: 'AdvisoryOnly',
      executed: true,
      remainingBudget: budget.limit - budget.used,
      fixtureScope: probe.scope,
      execution,
      observation,
      providerRequests: 0
    };
    write(resolve(output, 'investigation.json'), record);
    return record;
  } finally {
    closeSync(descriptor);
    unlinkSync(lock);
  }
};
