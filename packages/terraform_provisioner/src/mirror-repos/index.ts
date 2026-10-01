// Mirror Remote Terraform Module Repositories
// Public API and registry logic
// Implements terraform_provisioner spec 001

import path from 'path';
import fs from 'fs/promises';
import { pathToFileURL } from 'url';
import common from 'catalog_common';
import {
  configGit,
  gitCloneMirror,
  gitRemoteUpdate,
  gitFetchPrune,
} from '../utils';
import log from '../logger';

// The fixed base directory for all mirrors
export const MIRROR_ROOT = '/tmp/tfm_mirrors/';

// Mirror registry type
type MirrorRegistry = Map<string, string>; // Key: canonical repoID, Value: absolute mirror path

const mirrorRegistry: MirrorRegistry = new Map();
let mirrorsOptInEnabled = false;

/**
 * Returns true if the mirror subsystem is enabled for this process
 */
export function areMirrorsEnabled(): boolean {
  return mirrorsOptInEnabled;
}

export function enableMirrors() {
  mirrorsOptInEnabled = true;
}
let githubUrlRewriteConfigured = false;
let githubUrlRewriteConfigPromise: Promise<void> | null = null;

function normalizeRepoPath(repoPath: string): string {
  return repoPath.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

function extractRepoUrl(sourceOrUrl: string): string {
  let candidate = sourceOrUrl.trim();

  if (candidate.startsWith('git::')) {
    candidate = candidate.slice(5);
  }

  const queryIdx = candidate.indexOf('?');
  if (queryIdx !== -1) {
    candidate = candidate.slice(0, queryIdx);
  }

  const gitSubdirIdx = candidate.toLowerCase().indexOf('.git//');
  if (gitSubdirIdx !== -1) {
    return `${candidate.slice(0, gitSubdirIdx + 4)}`;
  }

  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(candidate);
  if (schemeMatch) {
    const subdirIdx = candidate.indexOf('//', schemeMatch[0].length);
    if (subdirIdx !== -1) {
      return candidate.slice(0, subdirIdx);
    }
  }

  return candidate;
}

export function getCanonicalRepoId(remoteUrl: string): string {
  const trimmed = extractRepoUrl(remoteUrl);

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const repoPath = normalizeRepoPath(parsed.pathname);
    if (
      !host ||
      !repoPath ||
      host.includes('..') ||
      host.includes('\\') ||
      repoPath.includes('\\') ||
      repoPath.split('/').some((seg) => !seg || seg === '.' || seg === '..')
    ) {
      throw new Error('Unsafe repo path');
    }
    return `${host}/${repoPath}`;
  } catch {
    const scpLikeMatch = /^(?:[^@]+@)?([^:/]+):(.+)$/.exec(trimmed);
    if (scpLikeMatch) {
      const host = scpLikeMatch[1].toLowerCase();
      const repoPath = normalizeRepoPath(scpLikeMatch[2]);
      if (
        !host ||
        !repoPath ||
        host.includes('..') ||
        host.includes('\\') ||
        repoPath.includes('\\') ||
        repoPath.split('/').some((seg) => !seg || seg === '.' || seg === '..')
      ) {
        throw new Error('Unsafe repo path');
      }
      return `${host}/${repoPath}`;
    }

    const normalized = normalizeRepoPath(trimmed);
    if (
      !normalized ||
      normalized.includes('\\') ||
      normalized.split('/').some((seg) => !seg || seg === '.' || seg === '..')
    ) {
      throw new Error('Unsafe repo path');
    }
    return normalized;
  }
}

function getRepoKey(remoteUrl: string): string {
  return getCanonicalRepoId(remoteUrl);
}

function getMirrorRelativePath(remoteUrl: string): string {
  const key = getRepoKey(remoteUrl);

  if (
    key.includes('\\') ||
    key.split('/').some((seg) => !seg || seg === '.' || seg === '..')
  ) {
    throw new Error('Unsafe repo key');
  }

  const segments = key.split('/');
  const repoName = segments.pop();

  if (!repoName) {
    throw new Error('Unsafe repo key');
  }

  return segments.length === 0
    ? repoName
    : path.posix.join(...segments, `${repoName}.git`);
}

function isGithubRepoUrl(repoUrl: string): boolean {
  const trimmedRepoUrl = repoUrl.trim();
  try {
    return new URL(trimmedRepoUrl).hostname.toLowerCase() === 'github.com';
  } catch {
    const scpLikeMatch = /^(?:[^@]+@)?([^:/]+):(.+)$/.exec(trimmedRepoUrl);
    return scpLikeMatch?.[1].toLowerCase() === 'github.com';
  }
}

async function ensureGithubUrlRewriteForMirror(): Promise<void> {
  if (githubUrlRewriteConfigured) {
    return;
  }

  const prefappBotPat =
    process.env[common.types.envVars.githubAppPatPrefapp] ?? '';

  if (!prefappBotPat.trim()) {
    return;
  }

  if (!githubUrlRewriteConfigPromise) {
    githubUrlRewriteConfigPromise = (async () => {
      await configGit(); // Static import, Constitution compliant
      githubUrlRewriteConfigured = true;
    })();
  }

  try {
    await githubUrlRewriteConfigPromise;
  } finally {
    githubUrlRewriteConfigPromise = null;
  }
}

export function deriveMirrorPath(remoteUrl: string): string {
  return path.posix.join(MIRROR_ROOT, getMirrorRelativePath(remoteUrl));
}

async function ensureSafeExistingMirrorPath(mirrorPath: string): Promise<void> {
  const mirrorLstat = await fs.lstat(mirrorPath);
  if (mirrorLstat.isSymbolicLink()) {
    throw new Error(`Mirror path exists and is a symlink: ${mirrorPath}`);
  }

  const [resolvedMirrorPath, resolvedMirrorRoot] = await Promise.all([
    fs.realpath(mirrorPath),
    fs.realpath(MIRROR_ROOT),
  ]);
  const normalizedResolvedMirrorRoot = resolvedMirrorRoot.endsWith(path.sep)
    ? resolvedMirrorRoot
    : `${resolvedMirrorRoot}${path.sep}`;
  if (
    resolvedMirrorPath !== resolvedMirrorRoot &&
    !resolvedMirrorPath.startsWith(normalizedResolvedMirrorRoot)
  ) {
    throw new Error(
      `Mirror path resolves outside mirror root: ${mirrorPath} -> ${resolvedMirrorPath}`,
    );
  }
}

export async function installMirrorForRepo(remoteUrl: string): Promise<string> {
  const repoUrl = extractRepoUrl(remoteUrl);

  if (isGithubRepoUrl(repoUrl)) {
    await ensureGithubUrlRewriteForMirror();
  }

  const mirrorPath = deriveMirrorPath(repoUrl);
  let stat = null;
  try {
    stat = await fs.stat(mirrorPath);
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      stat = null;
    } else {
      throw new Error(
        `Failed to stat mirror path ${mirrorPath}: ${error.message}`,
      );
    }
  }
  if (stat && stat.isDirectory()) {
    await ensureSafeExistingMirrorPath(mirrorPath);
    try {
      const configPath = path.join(mirrorPath, 'config');
      const headPath = path.join(mirrorPath, 'HEAD');
      await fs.access(configPath);
      await fs.access(headPath);
      log.info(`[mirror] Mirror exists at ${mirrorPath}, refreshing...`);
      await refreshMirror(mirrorPath);
    } catch (e) {
      throw new Error(
        `Mirror path exists but is not a valid git mirror: ${mirrorPath}`,
      );
    }
  } else if (stat === null) {
    try {
      await fs.mkdir(path.posix.dirname(mirrorPath), { recursive: true });
      log.info(`[mirror] Cloning bare mirror from ${repoUrl} to ${mirrorPath}`);
      await gitCloneMirror(repoUrl, mirrorPath);
    } catch (e) {
      throw new Error(`Failed to clone mirror: ${(e as Error).message}`);
    }
  } else {
    throw new Error(`Mirror path exists and is not a directory: ${mirrorPath}`);
  }
  mirrorRegistry.set(getRepoKey(repoUrl), mirrorPath);
  return mirrorPath;
}

function parseGitModuleSource(
  source: string,
): { url: string; subdir: string; query: string } | null {
  if (!source.startsWith('git::')) return null;

  const remainder = source.slice('git::'.length);
  const queryIndex = remainder.indexOf('?');
  const base = queryIndex === -1 ? remainder : remainder.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : remainder.slice(queryIndex);

  let searchStart = 0;
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(base);
  if (schemeMatch) {
    searchStart = schemeMatch[0].length;
  } else {
    const scpLikeMatch = /^[^/?\s]+@[^:/?\s]+:/.exec(base);
    if (scpLikeMatch) {
      searchStart = scpLikeMatch[0].length;
    }
  }

  const subdirIndex = base.indexOf('//', searchStart);
  const url = subdirIndex === -1 ? base : base.slice(0, subdirIndex);
  const subdir = subdirIndex === -1 ? '' : base.slice(subdirIndex);

  if (!url || /\s/.test(url)) return null;
  if (subdir && !/^\/\/[^?\s]+$/.test(subdir)) return null;

  return { url, subdir, query };
}

export function translateModuleSource(source: string): string {
  const parsed = parseGitModuleSource(source);
  if (!parsed) return source; // Not a supported git module source
  const { url, subdir, query } = parsed;
  const key = getRepoKey(url);
  const mirrorPath = mirrorRegistry.get(key);
  if (!mirrorPath) return source; // Not mirrored, return as-is
  let absMirrorPath = mirrorPath;
  if (!absMirrorPath.startsWith('/'))
    absMirrorPath = path.posix.resolve(absMirrorPath);
  const fileUrl = pathToFileURL(absMirrorPath).toString();
  return `git::${fileUrl}${subdir}${query}`;
}

export function _getMirrorRegistry(): ReadonlyMap<string, string> {
  return mirrorRegistry;
}

export function resetMirrorRegistry() {
  mirrorRegistry.clear();
}

/**
 * Refresh an existing git mirror by running 'git fetch --prune'.
 * Throws if the mirror is invalid or the fetch fails.
 */
export async function refreshMirror(mirrorPath: string): Promise<void> {
  // Check that path exists and looks like a valid git mirror repo.
  try {
    const stat = await fs.stat(mirrorPath);
    if (!stat.isDirectory()) throw new Error('Mirror path is not a directory');
    // Check git bare repo essentials: config and HEAD
    const configPath = path.join(mirrorPath, 'config');
    const headPath = path.join(mirrorPath, 'HEAD');
    await fs.access(configPath);
    await fs.access(headPath);
  } catch (err) {
    throw new Error(`Mirror path is not a valid git mirror: ${mirrorPath}`);
  }

  // If this is a github repo, ensure config is applied
  if (isGithubRepoUrl(mirrorPath)) {
    await ensureGithubUrlRewriteForMirror();
  }

  // Run the actual refresher, which throws on failure
  await gitFetchPrune(mirrorPath);
  log.debug(`[mirror] Mirror at ${mirrorPath} was successfully refreshed`);
}

// --- Spec 002-mirror-tfm-usage: Warmup support ---
export { initializeMirrors } from '../mirror-repos';
/**
 * Default repository list to be warmed up (mirrored) by the warmup API.
 * Callers can supply their own repo list to extend or override this default.
 */
export const DEFAULT_MIRROR_WARMUP_LIST: ReadonlyArray<string> = Object.freeze([
  'https://github.com/prefapp/tfm',
  // Add more default repos as needed
]);

/**
 * Warmup function: Installs or updates mirrors for a provided repo list (default: DEFAULT_MIRROR_WARMUP_LIST).
 * Returns a summary of success/failure for each repo.
 */
export async function warmupMirrors(
  repos: ReadonlyArray<string> = [...DEFAULT_MIRROR_WARMUP_LIST],
): Promise<{
  success: string[];
  failed: { repo: string; error: string }[];
}> {
  const results = { success: [], failed: [] } as {
    success: string[];
    failed: { repo: string; error: string }[];
  };
  for (const repo of repos) {
    try {
      await installMirrorForRepo(repo);
      results.success.push(repo);
    } catch (e) {
      results.failed.push({ repo, error: (e as Error).message });
    }
  }
  // Only enable mirrors if we completed the warmup call
  enableMirrors();
  return results;
}

/**
 * Resolves and installs a mirror for a git-backed Terraform root module source.
 * If translation is possible (eligible git::...), returns a local mirror source,
 * else returns the original source string unchanged.
 * Wraps both detection & mirror install. See spec 002-mirror-tfm-usage.
 */
export async function resolveMirroredModuleSource(
  source: string,
): Promise<string> {
  if (!areMirrorsEnabled()) {
    // Mirror feature not opted-in: always give original source
    return source;
  }
  if (!source.trim().startsWith('git::')) return source; // Not a supported git module source
  const repoUrl = extractRepoUrl(source);
  if (
    !repoUrl.startsWith('https://') &&
    !repoUrl.startsWith('ssh://') &&
    !repoUrl.startsWith('git@')
  ) {
    return source;
  }
  try {
    await installMirrorForRepo(repoUrl);
    return translateModuleSource(source);
  } catch (e) {
    log.warn(
      `[mirror] Could not mirror ${repoUrl}; failing provisioning. Reason: ${(e as Error).message}`,
    );
    throw e;
  }
}
