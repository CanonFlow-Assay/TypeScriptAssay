import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./firewall.ts', import.meta.url));
const sourceText = readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(sourceText, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    strict: true
  },
  reportDiagnostics: true
});
assert.equal(transpiled.diagnostics?.length ?? 0, 0, 'TypeScript configuration firewall must compile cleanly');

const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(transpiled.outputText, 'utf8').toString('base64');
const { loadConfiguration, canonicalConfiguration } = await import(moduleUrl);

test('CFG-001 canonical configuration firewall cases', () => {
  const cases = [
    [
      'valid',
      { 'Service:Endpoint': 'https://api.example.test', 'Service:RetryLimit': '3', 'Service:Mode': 'read-only' },
      'loaded|https://api.example.test/|3|ReadOnly'
    ],
    [
      'missing',
      { 'Service:Endpoint': 'https://api.example.test', 'Service:RetryLimit': '3' },
      'rejected|missing:Service:Mode'
    ],
    [
      'bad-uri',
      { 'Service:Endpoint': 'not-a-uri', 'Service:RetryLimit': '3', 'Service:Mode': 'write' },
      'rejected|invalid-uri:Service:Endpoint'
    ],
    [
      'bad-limit',
      { 'Service:Endpoint': 'https://api.example.test', 'Service:RetryLimit': '0', 'Service:Mode': 'write' },
      'rejected|invalid-range:Service:RetryLimit'
    ],
    [
      'bad-mode',
      { 'Service:Endpoint': 'https://api.example.test', 'Service:RetryLimit': '3', 'Service:Mode': 'admin' },
      'rejected|invalid-mode:Service:Mode'
    ],
    [
      'multiple-issues',
      { 'Service:Endpoint': 'ftp://bad.example.test', 'Service:RetryLimit': '99' },
      'rejected|invalid-uri:Service:Endpoint;invalid-range:Service:RetryLimit;missing:Service:Mode'
    ]
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(canonicalConfiguration(loadConfiguration(input)), expected, name);
  }
});

test('CFG-002 rejects getter and inherited properties and freezes output', () => {
  let getterCalled = 0;
  const withGetter = {
    'Service:Endpoint': 'https://api.example.test',
    'Service:RetryLimit': '3'
  };
  Object.defineProperty(withGetter, 'Service:Mode', {
    get() {
      getterCalled += 1;
      return 'read-only';
    },
    enumerable: true
  });
  const rejected = loadConfiguration(withGetter);
  assert.equal(rejected.kind, 'ConfigurationRejected');
  assert.equal(getterCalled, 0);

  const valid = loadConfiguration({
    'Service:Endpoint': 'https://api.example.test',
    'Service:RetryLimit': '4',
    'Service:Mode': 'write'
  });
  assert.equal(valid.kind, 'ConfigurationLoaded');
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(Object.isFrozen(valid.value), true);
});
