import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import fg from 'fast-glob';
import type { Policy, ScopeEvidence } from './model.js';

const normalized = (path: string): string => path.replaceAll('\\', '/');

const sort = (paths: readonly string[]): readonly string[] =>
  [...paths].sort((left, right) => left.localeCompare(right));

const glob = (root: string, pattern: string): readonly string[] =>
  sort(
    fg
      .sync(pattern, {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        unique: true,
        followSymbolicLinks: false
      })
      .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
      .map((path) => normalized(relative(root, path)))
  );

export interface ResolvedScope {
  readonly evidence: ScopeEvidence;
  readonly domainAbsolutePaths: ReadonlySet<string>;
  readonly boundaryAbsolutePaths: ReadonlySet<string>;
}

export const resolveScope = (root: string, policy: Policy): ResolvedScope => {
  if (!existsSync(root)) throw new Error(`Target does not exist: ${root}`);
  const domainMatches = policy.domainGlobs.flatMap((pattern) => glob(root, pattern));
  const boundaryMatches = policy.boundaryGlobs.flatMap((pattern) => glob(root, pattern));
  const excludedMatches = policy.excludedGlobs.flatMap((pattern) => glob(root, pattern));
  const exclusions = new Set(excludedMatches);
  const domainPaths = sort([...new Set(domainMatches)].filter((path) => !exclusions.has(path)));
  const boundaryPaths = sort([...new Set(boundaryMatches)].filter((path) => !exclusions.has(path)));
  const scannedPaths = sort([...new Set([...domainPaths, ...boundaryPaths])]);
  const unmatchedGlobs = sort([
    ...policy.domainGlobs.filter((pattern) => glob(root, pattern).length === 0),
    ...policy.boundaryGlobs.filter((pattern) => glob(root, pattern).length === 0),
    ...policy.excludedGlobs.filter((pattern) => glob(root, pattern).length === 0)
  ]);
  const requiredUnmatched = [...policy.domainGlobs, ...policy.boundaryGlobs].some(
    (pattern) => glob(root, pattern).length === 0
  );
  const evidence: ScopeEvidence = {
    scannedPaths,
    domainPaths,
    boundaryPaths,
    excludedPaths: sort([...new Set(excludedMatches)]),
    unmatchedGlobs,
    complete: scannedPaths.length > 0 && !requiredUnmatched
  };
  return {
    evidence,
    domainAbsolutePaths: new Set(domainPaths.map((path) => resolve(root, path))),
    boundaryAbsolutePaths: new Set(boundaryPaths.map((path) => resolve(root, path)))
  };
};
