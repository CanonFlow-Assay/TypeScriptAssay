import { existsSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fg from 'fast-glob';
import ts from 'typescript';
import type { LoadedPolicy } from './policy.js';
import { resolveScope } from './scope.js';
interface Identity {
  readonly path: string;
  readonly inode: string | null;
}
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const identity = (file: string): Identity => {
  const absolute = resolve(file);
  if (existsSync(absolute)) {
    const stat = statSync(absolute);
    return { path: realpathSync(absolute), inode: String(stat.dev) + ':' + String(stat.ino) };
  }
  const tail: string[] = [];
  let parent = absolute;
  while (!existsSync(parent)) {
    tail.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  return { path: resolve(realpathSync(parent), ...tail), inode: null };
};
const aliases = (a: Identity, b: Identity): boolean =>
  a.path === b.path || (a.inode !== null && a.inode === b.inode);
export const validateArtifactPaths = (
  target: string,
  outputs: readonly string[],
  loaded?: LoadedPolicy
): void => {
  let root = loaded?.root ?? resolve(target);
  while (!existsSync(root)) root = dirname(root);
  if (statSync(root).isFile()) root = dirname(root);
  const protectedFiles = fg.sync(
    [
      '**/*.ts',
      '**/*.tsx',
      '**/tsconfig*.json',
      '**/package.json',
      '**/package-lock.json',
      '**/.tsassay.json'
    ],
    {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: ['node_modules/**', 'dist/**', 'artifacts/**', '.git/**']
    }
  );
  if (loaded) {
    protectedFiles.push(
      loaded.path,
      ...resolveScope(loaded.root, loaded.policy).evidence.scannedPaths.map((file) =>
        resolve(loaded.root, file)
      )
    );
    for (const command of loaded.policy.requiredCommands)
      for (const token of command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []) {
        const file = resolve(loaded.root, token.replace(/^['"]|['"]$/g, ''));
        if (existsSync(file) && statSync(file).isFile()) protectedFiles.push(file);
      }
  }
  const config = ts.findConfigFile(root, (file) => ts.sys.fileExists(file), 'tsconfig.json');
  if (config) {
    protectedFiles.push(config);
    try {
      const source = ts.readJsonConfigFile(config, (file) => ts.sys.readFile(file));
      ts.parseJsonSourceFileConfigFileContent(source, ts.sys, dirname(config));
      protectedFiles.push(...(source.extendedSourceFiles ?? []));
    } catch {
      /* Invalid project evidence is handled by the existing evaluator. */
    }
  }
  protectedFiles.push(
    ...readdirSync(sourceRoot)
      .filter((file) => /\.[jt]s$/.test(file))
      .map((file) => resolve(sourceRoot, file)),
    require.resolve('typescript')
  );
  const protectedIdentities = protectedFiles.map(identity),
    chosen: Identity[] = [];
  for (const output of outputs) {
    const current = identity(output);
    if (protectedIdentities.some((input) => aliases(input, current)))
      throw new Error('Artifact destination aliases an observed input or evaluator');
    if (chosen.some((previous) => aliases(previous, current)))
      throw new Error('Artifact destinations alias each other');
    chosen.push(current);
  }
};
