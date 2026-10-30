import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url)),
  specimen = resolve(root, 'reservation');
const fixture = (action) => {
  const parent = resolve(root, '../artifacts');
  mkdirSync(parent, { recursive: true });
  const tmp = mkdtempSync(resolve(parent, 'workflow-regression-'));
  try {
    cpSync(specimen, tmp, { recursive: true });
    action(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
const execute = (tmp, env = {}) =>
  spawnSync(process.execPath, [resolve(tmp, 'run-tests.mjs')], {
    cwd: tmp,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30000
  });
test('compiler override cannot reuse stale emitted code', () =>
  fixture((tmp) => {
    const source = resolve(tmp, 'src/domain/reservation.ts'),
      old = readFileSync(resolve(tmp, 'build/domain/reservation.js'), 'utf8');
    writeFileSync(
      source,
      readFileSync(source, 'utf8').replace('stock - quantity', 'stock + quantity')
    );
    const noop = resolve(tmp, 'noop.cjs');
    writeFileSync(noop, 'process.exit(0);');
    const result = execute(tmp, { TS_ASSAY_PLAYGROUND_COMPILER: noop });
    assert.notEqual(result.status, 0);
    assert.notEqual(readFileSync(resolve(tmp, 'build/domain/reservation.js'), 'utf8'), old);
    assert.match(result.stdout, /not ok/);
  }));
test('failed compilation cannot fall back to stale outputs', () =>
  fixture((tmp) => {
    writeFileSync(resolve(tmp, 'src/domain/reservation.ts'), 'export const broken = );');
    const result = execute(tmp);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(resolve(tmp, 'build/compilation.json')), false);
  }));
test('an empty test selection cannot satisfy the retained minimum', () =>
  fixture((tmp) => {
    writeFileSync(resolve(tmp, 'tests/expanded.test.js'), '');
    const result = execute(tmp);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /at least14/);
  }));
