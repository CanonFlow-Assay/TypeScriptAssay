import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const environment = { ...process.env };
delete environment.NODE_TEST_CONTEXT;
const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');
const version = require('typescript/package.json').version;
if (version !== '5.7.3') throw new Error('Playground requires pinned TypeScript 5.7.3');
// Old output is never a fallback for a missing, failed or no-op compiler.
rmSync(new URL('./build', import.meta.url), { recursive: true, force: true });
const compile = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json'], {
  cwd: new URL('.', import.meta.url),
  stdio: 'inherit',
  timeout: 30000
});
if (compile.error || compile.signal || compile.status !== 0) {
  process.exitCode = compile.status || 2;
} else {
  const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  // Missing emitted modules fail before tests. Bind source and actual compiler bytes.
  const binding = {
    typescript: version,
    compilerSha256: hash(compiler),
    compilerDriverSha256: hash(require.resolve('typescript/lib/tsc.js')),
    implementationSha256: hash(require.resolve('typescript')),
    sourceSha256: hash(new URL('./src/domain/reservation.ts', import.meta.url)),
    adapterSourceSha256: hash(new URL('./src/adapters/decode.ts', import.meta.url)),
    emittedDomainSha256: hash(new URL('./build/domain/reservation.js', import.meta.url)),
    emittedAdapterSha256: hash(new URL('./build/adapters/decode.js', import.meta.url))
  };
  writeFileSync(
    new URL('./build/compilation.json', import.meta.url),
    JSON.stringify(binding, null, 2)
  );
  console.log(JSON.stringify(binding));
  const tests = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', 'tests/expanded.test.js'],
    {
      cwd: new URL('.', import.meta.url),
      env: environment,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    }
  );
  process.stdout.write(tests.stdout ?? '');
  process.stderr.write(tests.stderr ?? '');
  const summary = (label) => {
    const prefix = '# ' + label + ' ';
    const line = tests.stdout?.split('\n').find((line) => line.startsWith(prefix));
    return line === undefined ? NaN : Number(line.slice(prefix.length));
  };
  const count = summary('tests');
  const forbidden = ['fail', 'cancelled', 'skipped'].some((label) => summary(label) !== 0);
  if (!Number.isSafeInteger(count) || count < 14 || forbidden) {
    console.error(
      'Reservation evidence requires at least14 executed tests with zero failures, cancellations or skips.'
    );
    process.exitCode = 1;
  }
  if (tests.error || tests.signal || tests.status !== 0) process.exitCode = tests.status || 2;
}
