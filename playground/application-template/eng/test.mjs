import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url),
  app = JSON.parse(readFileSync(new URL('../assay.app.json', import.meta.url), 'utf8'));
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const prepare = spawnSync(process.execPath, ['eng/prepare.mjs'], {
  cwd: root,
  env,
  stdio: 'inherit',
  timeout: 30000
});
if (prepare.error || prepare.signal || prepare.status !== 0) process.exit(2);
for (const selection of app.selections) {
  if (selection.command[0] !== 'node') throw new Error('Unsupported command');
  const run = spawnSync(process.execPath, selection.command.slice(1), {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30000
  });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  const names = [...(run.stdout ?? '').matchAll(/^ok \d+ - (.+)$/gm)].map((match) => match[1]);
  if (
    run.error ||
    run.signal ||
    run.status !== 0 ||
    names.length < selection.minimum ||
    !selection.names.every((name) => names.includes(name)) ||
    /# (SKIP|TODO)/.test(run.stdout ?? '')
  ) {
    process.exitCode = 1;
    break;
  }
}
