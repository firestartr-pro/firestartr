import common from 'catalog_common';
import type { E2EApi } from '../types';
import { retryAsync } from '../utils/async-control';
import { isTransientError } from '../utils/transient-errors';
import {
  buildClaimRef,
  FIRESTARTR_API_VERSION,
  getRelatedCrKindsForClaimKind,
  isOrgResourceClaimKind,
} from '../claim-taxonomy';
import { DELETE_TIMEOUT_SECONDS } from './constants';
import { resolveFixtureMetadata } from './fixture-metadata';
import {
  getDeletionOrder,
  resolveFixtureResources,
  type ResolvedFixtureResource,
} from './fixture-plan';
import { destroyOrgResources } from './org-resources';
import type {
  DestroyFixtureResourcesOptions,
  FixtureResourceInput,
} from './types';

const CLAIM_REF_ANNOTATION =
  common.generic.getFirestartrAnnotation('claim-ref');
const CLEANUP_STEP_RETRY_ATTEMPTS = 3;
const CLEANUP_STEP_RETRY_BACKOFF_MS = 1500;

async function runLoggedDeletionStep(
  logPrefix: string,
  label: string,
  run: () => Promise<void>,
): Promise<void> {
  const start = Date.now();
  common.logger.info(`[${logPrefix}] ${label} started`);

  try {
    await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    common.logger.error(
      `[${logPrefix}] ${label} failed after ${Date.now() - start}ms: ${message}`,
    );
    throw err;
  }

  common.logger.info(
    `[${logPrefix}] ${label} completed in ${Date.now() - start}ms`,
  );
}

async function runLoggedDeletionStepWithRetry(
  logPrefix: string,
  label: string,
  run: () => Promise<void>,
): Promise<void> {
  await retryAsync(() => runLoggedDeletionStep(logPrefix, label, run), {
    attempts: CLEANUP_STEP_RETRY_ATTEMPTS,
    shouldRetry: isTransientError,
    getDelayMs: (_err, attempt) => CLEANUP_STEP_RETRY_BACKOFF_MS * attempt,
    onRetry: (err, attempt, delayMs) => {
      common.logger.warn(
        `[${logPrefix}] ${label} retrying in ${delayMs}ms (attempt ${attempt + 1}/${CLEANUP_STEP_RETRY_ATTEMPTS}) due to: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    },
  });
}

async function destroyClusterResolvedFixtureResources(
  client: E2EApi,
  resolvedFixtures: ResolvedFixtureResource[],
): Promise<void> {
  const resolvedMetadata = await resolveFixtureMetadata(
    client,
    resolvedFixtures,
  );
  const claimRefsByKind = new Map<string, Set<string>>();
  const kindOrder: string[] = [];

  // Mirror teardown behavior: delete in reverse fixture order so dependencies
  // are removed child-first. Deletions are batched by kind to reduce API calls.
  for (const { claimKind, claimName } of getDeletionOrder(resolvedMetadata)) {
    const kinds = getRelatedCrKindsForClaimKind(claimKind);
    if (kinds.length === 0) {
      continue;
    }

    const claimRef = buildClaimRef(claimKind, claimName);

    for (const kind of kinds) {
      const claimRefs = claimRefsByKind.get(kind);
      if (claimRefs) {
        claimRefs.add(claimRef);
        continue;
      }

      claimRefsByKind.set(kind, new Set([claimRef]));
      kindOrder.push(kind);
    }
  }

  for (const kind of kindOrder) {
    const claimRefs = claimRefsByKind.get(kind);
    if (!claimRefs || claimRefs.size === 0) {
      continue;
    }

    await client.k8s.deleteCustomResourcesByAnnotation({
      kind,
      apiVersion: FIRESTARTR_API_VERSION,
      annotationKey: CLAIM_REF_ANNOTATION,
      annotationValues: [...claimRefs],
      timeout: DELETE_TIMEOUT_SECONDS,
      forceFinalizers: true,
    });
  }
}

export async function destroyClusterFixtureResources(
  client: E2EApi,
  prefix: string,
  fixtures: FixtureResourceInput[],
): Promise<void> {
  const resolvedFixtures = resolveFixtureResources(prefix, fixtures);
  await destroyClusterResolvedFixtureResources(client, resolvedFixtures);
}

// Shared pre-clean helper for fixture-based tests.
//
// It derives the cleanup plan from the fixture creation list and applies
// deletion in reverse order (child-first), matching teardown semantics.
export async function destroyFixtureResources(
  client: E2EApi,
  prefix: string,
  fixtures: FixtureResourceInput[],
  options: DestroyFixtureResourcesOptions = {},
): Promise<void> {
  const resolvedFixtures = resolveFixtureResources(prefix, fixtures);
  const resolvedMetadata = await resolveFixtureMetadata(
    client,
    resolvedFixtures,
  );
  const deleteCluster = options.deleteCluster ?? true;
  const deleteOrg = options.deleteOrg ?? true;
  const logPrefix = options.logPrefix?.trim() || 'e2e-fixture-cleanup';

  common.logger.info(
    `[${logPrefix}] cleanup start (prefix=${prefix || '<empty>'}, fixtures=${resolvedFixtures.length})`,
  );

  const errors: string[] = [];

  if (deleteCluster) {
    try {
      await runLoggedDeletionStepWithRetry(
        logPrefix,
        'deleting stale cluster fixture resources',
        () => destroyClusterResolvedFixtureResources(client, resolvedFixtures),
      );
    } catch (err) {
      errors.push(
        `deleting stale cluster fixture resources: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (deleteOrg) {
    try {
      const orgResourceNames = resolvedMetadata
        .filter(({ claimKind }) => isOrgResourceClaimKind(claimKind))
        .map(({ claimName }) => claimName);

      await runLoggedDeletionStepWithRetry(
        logPrefix,
        'deleting stale org fixture resources',
        () =>
          destroyOrgResources(client, orgResourceNames, {
            includePrefixed: options.includePrefixed,
            orgWebhookUrls: options.orgWebhookUrls,
            strict: options.strict,
          }),
      );
    } catch (err) {
      errors.push(
        `deleting stale org fixture resources: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}
