import { homedir } from 'os';
import { realpathSync } from 'fs';
import { join, resolve } from 'path';

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

/** Expands a leading `~` to the home directory; leaves other paths alone. */
function expandHome(value: string, home: string = homedir()): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));
  return value;
}

/** Absolute, `..`-free, no trailing slash: the form used for comparisons. */
function normalizeContextPath(value: string, home: string = homedir()): string {
  return resolve(expandHome(value, home));
}

/**
 * Symlinks resolved, so a config path and the physical cwd it points at still
 * match. Paths that do not exist yet (a not-yet-cloned checkout) keep their
 * normalized form.
 */
function canonicalContextPath(value: string, home: string = homedir()): string {
  const normalized = normalizeContextPath(value, home);
  try {
    return realpathSync(normalized);
  } catch {
    return normalized;
  }
}

/** Collapses a path under the home directory back to `~`-form for display. */
function displayContextPath(value: string, home: string = homedir()): string {
  const normalizedHome = normalizeContextPath(home, home);
  if (value === normalizedHome) return '~';
  if (value.startsWith(`${normalizedHome}/`)) {
    return `~${value.slice(normalizedHome.length)}`;
  }
  return value;
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
  // One entry per matching (organization, canonical path) pair, longest first.
  const matches: Array<PathMatch & { canonicalPath: string }> = [];
  let longest = -1;

  for (const organization of organizations) {
    for (const storedPath of organization.paths) {
      const normalizedPath = normalizeContextPath(storedPath, home);
      const canonicalPath = canonicalContextPath(normalizedPath, home);
      if (!contains(directory, canonicalPath)) continue;
      if (canonicalPath.length < longest) continue;
      if (canonicalPath.length > longest) {
        longest = canonicalPath.length;
        matches.length = 0;
      }
      const duplicate = matches.some(
        (match) =>
          match.organization.name === organization.name &&
          match.canonicalPath === canonicalPath,
      );
      if (duplicate) continue;
      matches.push({
        organization,
        canonicalPath,
        matchedPath: displayContextPath(normalizedPath, home),
      });
    }
  }

  const [first] = matches;
  if (!first) return { kind: 'no-match' };
  if (matches.length > 1) {
    return {
      kind: 'ambiguous',
      matchedPath: first.matchedPath,
      organizations: matches.map((match) => match.organization),
    };
  }
  return {
    kind: 'match',
    organization: first.organization,
    matchedPath: first.matchedPath,
  };
}

function contains(directory: string, storedPath: string): boolean {
  if (directory === storedPath) return true;
  return storedPath.endsWith('/')
    ? directory.startsWith(storedPath)
    : directory.startsWith(`${storedPath}/`);
}
