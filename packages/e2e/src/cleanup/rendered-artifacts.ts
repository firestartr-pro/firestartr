import fs from 'node:fs/promises';
import { getE2EState } from '../api/internal-state';
import type { E2EApi } from '../types';
import { DELETE_TIMEOUT_SECONDS } from './constants';

/**
 * Teardown helper: deletes every applied CR from the cluster, removes
 * temporary render output directories, and destroys the claims context.
 *
 * Artifacts are tracked internally by claims.renderLocally().
 * Safe to call even when no render has run yet.
 */
export async function cleanupRenderedArtifacts(client: E2EApi): Promise<void> {
  const artifacts = [...getE2EState(client).renderedArtifacts];
  const deletedCrPaths = new Set<string>();

  // Teardown should happen in reverse render/apply order so dependencies are
  // deleted child-first.
  for (const { crPath } of [...artifacts].reverse()) {
    if (!crPath || deletedCrPaths.has(crPath)) continue;

    await client.k8s.deleteCr(crPath, DELETE_TIMEOUT_SECONDS);
    deletedCrPaths.add(crPath);
  }

  const outputPaths = new Set(
    artifacts
      .map(({ outputPath }) => outputPath)
      .filter((outputPath): outputPath is string => Boolean(outputPath)),
  );
  for (const outputPath of outputPaths) {
    await fs.rm(outputPath, { recursive: true, force: true });
  }

  await client.claims.destroyContext();
}
