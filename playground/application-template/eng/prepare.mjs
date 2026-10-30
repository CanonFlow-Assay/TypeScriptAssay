import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const version = require('typescript/package.json').version;
if (version !== '5.7.3') throw new Error('Pinned TypeScript5.7.3 is required');
rmSync(new URL('../build', import.meta.url), { recursive: true, force: true });
const compiler = require.resolve('typescript/bin/tsc');
const run = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json'], {
  cwd: new URL('../', import.meta.url),
  stdio: 'inherit',
  timeout: 30000
});
if (run.error || run.signal || run.status !== 0) process.exitCode = run.status || 2;
else {
  const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const binding = {
    typescript: version,
    driverSha256: hash(require.resolve('typescript/lib/tsc.js')),
    implementationSha256: hash(require.resolve('typescript')),
    domainSourceSha256: hash(new URL('../src/domain/reservation.ts', import.meta.url)),
    decoderSourceSha256: hash(new URL('../src/adapters/decode.ts', import.meta.url)),
    domainBinarySha256: hash(new URL('../build/domain/reservation.js', import.meta.url)),
    decoderBinarySha256: hash(new URL('../build/adapters/decode.js', import.meta.url)),
    stockClientBinarySha256: hash(new URL('../build/adapters/stock-client.js', import.meta.url))
  };
  writeFileSync(new URL('../build/compilation.json', import.meta.url), JSON.stringify(binding));
  console.log(JSON.stringify(binding));
}
