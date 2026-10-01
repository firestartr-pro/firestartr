import {
  warmupMirrors,
  DEFAULT_MIRROR_WARMUP_LIST,
  refreshMirror,
  _getMirrorRegistry,
  getCanonicalRepoId,
  installMirrorForRepo,
  deriveMirrorPath,
  resetMirrorRegistry,
  MIRROR_ROOT,
  resolveMirroredModuleSource,
  translateModuleSource,
  enableMirrors,
  areMirrorsEnabled,
} from './mirror-repos/index';

export {
  warmupMirrors,
  DEFAULT_MIRROR_WARMUP_LIST,
  refreshMirror,
  _getMirrorRegistry,
  getCanonicalRepoId,
  installMirrorForRepo,
  deriveMirrorPath,
  resetMirrorRegistry,
  MIRROR_ROOT,
  resolveMirroredModuleSource,
  translateModuleSource,
  enableMirrors,
  areMirrorsEnabled,
};
import log from './logger';

import common from 'catalog_common';

import * as fs from 'fs';

interface MirrorSummary {
  success: string[];
  failed: { repo: string; error: string }[];
  initializeRefresher: (
    runEvery: number,
    beforeRefresh?: () => Promise<void>,
    onError?: (error: Error) => void | Promise<void>,
  ) => { stop: () => void };
}

import { configGit } from './utils';

// High-level async API for pre-initializing a set of mirrors and periodic refresh
export async function initializeMirrors(
  repos: ReadonlyArray<string> = [...DEFAULT_MIRROR_WARMUP_LIST],
): Promise<MirrorSummary> {
  // HUMAN: we need to ensure the git is properly configured
  await configGit();

  const summary = await warmupMirrors(repos);
  // Only after successful warmup, enable mirrors
  // Mirrors are enabled as a side effect of warmupMirrors

  // Only refresh successful mirrors
  const initializedRepos = summary.success.slice();

  function initializeRefresher(
    runEvery: number,
    beforeRefresh?: () => Promise<void>,
    onError?: (error: Error) => void | Promise<void>,
  ) {
    if (typeof runEvery !== 'number' || runEvery <= 0) {
      throw new Error('runEvery must be a positive number (seconds)');
    }
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      if (stopped) return;
      try {
        if (beforeRefresh) {
          await beforeRefresh();
        }
      } catch (err: any) {
        if (onError) {
          await onError(err);
        } else {
          log.error('[mirror] Refresher beforeRefresh error:', err);
        }
        return; // skip this tick if beforeRefresh fails
      }
      for (const repo of initializedRepos) {
        const mirrorRegistry = _getMirrorRegistry();
        const mirrorPath = mirrorRegistry.get(
          // repo key computation matches the underlying registry
          getCanonicalRepoId(repo),
        );
        if (!mirrorPath) continue;
        try {
          await refreshMirror(mirrorPath);
        } catch (err: any) {
          if (onError) {
            await onError(err);
          } else {
            log.error('[mirror] Refresher error:', err);
          }
        }
      }
    };
    timer = setInterval(() => {
      void tick();
    }, runEvery * 1000);
    return {
      stop: () => {
        stopped = true;
        if (timer) clearInterval(timer);
      },
    };
  }
  return Object.assign(summary, { initializeRefresher });
}
