import { homedir } from 'os';
import { realpathSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';

import type { OrganizationConfig } from './config.js';

export interface PathMatch {
  organization: OrganizationConfig;
  /** The matched path as shown to the user: `~`-collapsed when under home. */
  matchedPath: string;
}

export type MatchOutcome =
  | ({ kind: 'match' } & PathMatch)
  | { kind: 'no-match' }
  | {
      kind: 'ambiguous';
      matchedPath: string;
      organizations: OrganizationConfig[];
    };

function expandHome(value: string, home: string = homedir()): string {
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(home, value.slice(2));
  }
  return value;
}

function normalizeContextPath(value: string, home: string = homedir()): string {
  return resolve(expandHome(value, home));
}

function canonicalContextPath(value: string, home: string = homedir()): string {
  const normalized = normalizeContextPath(value, home);
  try {
    return realpathSync(normalized);
  } catch {
    return normalized;
  }
}

function displayContextPath(value: string, home: string = homedir()): string {
  const normalizedHome = normalizeContextPath(home, home);
  return contains(value, normalizedHome)
    ? join('~', relative(normalizedHome, value))
    : value;
}

/**
 * Resolves the organization owning `cwd`: a stored path matches when it equals
 * the directory or prefixes it on a segment boundary, and the longest stored
 * path wins. The same longest path claimed by two organizations is ambiguous.
 */
export function matchOrganization(
  organizations: OrganizationConfig[],
  cwd: string,
  home: string = homedir(),
): MatchOutcome {
  const directory = canonicalContextPath(cwd, home);
  const longestMatches: Array<PathMatch & { canonicalPath: string }> = [];
  let longestPathLength = -1;

  for (const organization of organizations) {
    for (const storedPath of organization.paths) {
      const normalizedPath = normalizeContextPath(storedPath, home);
      const canonicalPath = canonicalContextPath(normalizedPath, home);
      if (!contains(directory, canonicalPath)) continue;
      if (canonicalPath.length < longestPathLength) continue;
      if (canonicalPath.length > longestPathLength) {
        longestPathLength = canonicalPath.length;
        longestMatches.length = 0;
      }
      const duplicate = longestMatches.some(
        (match) =>
          match.organization.name === organization.name &&
          relative(match.canonicalPath, canonicalPath) === '',
      );
      if (duplicate) continue;
      longestMatches.push({
        organization,
        canonicalPath,
        matchedPath: displayContextPath(normalizedPath, home),
      });
    }
  }

  const [first] = longestMatches;
  if (!first) return { kind: 'no-match' };
  if (longestMatches.length > 1) {
    return {
      kind: 'ambiguous',
      matchedPath: first.matchedPath,
      organizations: longestMatches.map((match) => match.organization),
    };
  }
  return {
    kind: 'match',
    organization: first.organization,
    matchedPath: first.matchedPath,
  };
}

function contains(directory: string, storedPath: string): boolean {
  const rel = relative(storedPath, directory);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
