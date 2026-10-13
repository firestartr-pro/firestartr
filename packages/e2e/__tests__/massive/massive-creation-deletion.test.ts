import common from 'catalog_common';
import {
  CleanupRunner,
  cleanupRenderedArtifacts,
  createNameBuilder,
  destroyFixtureResources,
  destroyOrgResources,
  initE2e,
  type E2EApi,
  type FixtureResourceInput,
  type JsonPatchOperation,
} from '../..';
import {
  buildMassivePlan,
  parseMassiveConfig,
  splitBatches,
  type MassiveGroupTemplate,
  type MassiveRepositoryTemplate,
} from '../../src/massive-plan';
import {
  buildComponentClaimPatches,
  buildGroupClaimPatches,
} from '../../src/claim-patches';
import { readK8sResource } from '../../src/cr-finder';
import { isRetryableGitHubError } from '../../src/gh/wait';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
} from '../../src/utils/async-control';

const MASSIVE_RUN_ENV_VAR = 'E2E_RUN_MASSIVE';
const MASSIVE_SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const MASSIVE_TEST_TIMEOUT_MS = 80 * 60 * 1000;
const MASSIVE_CLEANUP_TIMEOUT_MS = 25 * 60 * 1000;
const REPO_DELETE_WAIT_TIMEOUT_SECONDS = 20 * 60;
const GROUP_DELETE_WAIT_TIMEOUT_SECONDS = 20 * 60;
const CANARY_DELETE_TIMEOUT_MS = 5 * 60 * 1000;
const CANARY_DELETE_POLL_INTERVAL_MS = 10000;
const describeMassiveE2e =
  process.env[MASSIVE_RUN_ENV_VAR] === 'true' ? describe : describe.skip;

function groupPatches(
  template: MassiveGroupTemplate,
  org: string,
): JsonPatchOperation[] {
  return buildGroupClaimPatches({
    name: template.claimName,
    org,
    description: template.description,
    displayName: template.displayName,
    members: [],
  });
}

function repositoryPatches(
  template: MassiveRepositoryTemplate,
  org: string,
): JsonPatchOperation[] {
  return buildComponentClaimPatches({
    name: template.claimName,
    org,
    ownerRef: template.ownerRef,
    description: template.description,
    extraPatches: [
      {
        op: 'replace',
        path: '/providers/github/overrides/spec/repo/topics',
        value: template.topics,
      },
      {
        op: 'add',
        path: '/providers/github/features',
        value: template.features,
      },
    ],
  });
}
async function rateGate(
  client: E2EApi,
  label: string,
  minRemaining: number,
  resetCushionMs: number,
  disableSleepGuards: boolean,
): Promise<void> {
  const rateLimit = await client.gh.getRateLimit();
  const resetMs = rateLimit.core.reset * 1000;
  common.logger.info(
    `[massive] rate ${label}: remaining=${rateLimit.core.remaining}/` +
      `${rateLimit.core.limit} reset=${new Date(resetMs).toISOString()}`,
  );

  if (rateLimit.core.remaining >= minRemaining) return;

  const delayMs = Math.max(0, resetMs - Date.now() + resetCushionMs);
  if (disableSleepGuards) {
    common.logger.warn(
      `[massive] rate ${label}: would sleep ${delayMs}ms until reset ` +
        'cushion, but sleeping guards are disabled',
    );
    return;
  }

  common.logger.warn(
    `[massive] rate ${label}: sleeping ${delayMs}ms until reset cushion`,
  );
  await common.generic.sleep(delayMs);

  const refreshedRateLimit = await client.gh.getRateLimit();
  const refreshedResetMs = refreshedRateLimit.core.reset * 1000;
  common.logger.info(
    `[massive] rate ${label}: after sleep remaining=` +
      `${refreshedRateLimit.core.remaining}/${refreshedRateLimit.core.limit} ` +
      `reset=${new Date(refreshedResetMs).toISOString()}`,
  );
}

async function renderGroup(
  client: E2EApi,
  template: MassiveGroupTemplate,
): Promise<string[]> {
  const rendered = await client.claims.renderLocally(template.claimName, {
    sourceFixtureName: template.fixtureName,
    claimName: template.claimName,
    patches: groupPatches(template, client.getOrg()),
  });
  return rendered.crPaths;
}

async function renderRepository(
  client: E2EApi,
  template: MassiveRepositoryTemplate,
): Promise<string[]> {
  const rendered = await client.claims.renderLocally(template.claimName, {
    sourceFixtureName: template.fixtureName,
    claimName: template.claimName,
    patches: repositoryPatches(template, client.getOrg()),
  });
  return rendered.crPaths;
}

function getRenderedCrPaths(
  renderedResources: Map<string, string[]>,
  resourceKind: 'repository' | 'group',
  claimName: string,
): string[] {
  const crPaths = renderedResources.get(claimName);

  if (!crPaths || crPaths.length === 0) {
    throw new Error(
      `[massive] missing rendered ${resourceKind} CR paths for claim ${claimName}`,
    );
  }

  return crPaths;
}

function sortedTopics(topics: string[]): string[] {
  return [...topics].sort();
}

async function retryTransientGitHubProbe<T>(
  probe: () => Promise<T>,
): Promise<T> {
  try {
    return await probe();
  } catch (error) {
    if (isRetryableGitHubError(error)) {
      throw createRetryableError(error);
    }

    throw error;
  }
}

function logRetryableGitHubPollError(error: unknown, intervalMs: number): void {
  common.logger.warn(
    `[massive] retrying GitHub poll after ${intervalMs}ms due to: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

function repositoryMatchesTemplate(
  repoInfo: { description: string | null; topics: string[] },
  template: MassiveRepositoryTemplate,
): boolean {
  const actualTopics = sortedTopics(repoInfo.topics);
  const expectedTopics = sortedTopics(template.topics);

  return (
    repoInfo.description === template.description &&
    actualTopics.length === expectedTopics.length &&
    actualTopics.every((topic, index) => topic === expectedTopics[index])
  );
}

async function expectRepositoryMetadata(
  client: E2EApi,
  template: MassiveRepositoryTemplate,
): Promise<void> {
  const repoInfo = await pollUntil(
    () =>
      retryTransientGitHubProbe(() =>
        client.gh.getRepoInfo(template.claimName),
      ),
    {
      timeoutMs: 5 * 60 * 1000,
      intervalMs: 10000,
      isDone: (currentRepoInfo) =>
        repositoryMatchesTemplate(currentRepoInfo, template),
      shouldRetryError: isRetryableError,
      onRetryError: logRetryableGitHubPollError,
      createTimeoutError: (lastRepoInfo) =>
        new Error(
          `[massive] repository ${template.claimName} metadata did not ` +
            `match expected description/topics. Expected ${JSON.stringify({
              description: template.description,
              topics: sortedTopics(template.topics),
            })}; last observed ${JSON.stringify(lastRepoInfo ?? null)}`,
        ),
    },
  );

  expect(repoInfo.description).toBe(template.description);
  expect(sortedTopics(repoInfo.topics)).toEqual(sortedTopics(template.topics));
}

async function sleepForGuard(
  label: string,
  delayMs: number,
  disableSleepGuards: boolean,
): Promise<void> {
  if (delayMs <= 0) return;

  if (disableSleepGuards) {
    common.logger.info(
      `[massive] ${label}: skipping ${delayMs}ms sleep because sleeping ` +
        'guards are disabled',
    );
    return;
  }

  await common.generic.sleep(delayMs);
}

async function applyAndWaitBatch(
  client: E2EApi,
  label: string,
  crPathsByItem: string[][],
  staggerMs: number,
  disableSleepGuards: boolean,
): Promise<void> {
  for (const [index, crPaths] of crPathsByItem.entries()) {
    common.logger.info(
      `[massive] ${label}: applying item ${index + 1}/${crPathsByItem.length}`,
    );
    for (const crPath of crPaths) {
      await client.k8s.applyCr(crPath);
    }
    if (index < crPathsByItem.length - 1) {
      await sleepForGuard(
        `${label}: apply stagger`,
        staggerMs,
        disableSleepGuards,
      );
    }
  }

  for (const crPaths of crPathsByItem) {
    for (const crPath of crPaths) {
      await client.k8s.waitForCr(crPath);
    }
  }
}

async function splitRepositoryCrPaths(crPaths: string[]): Promise<{
  repository: string[];
  dependents: string[];
}> {
  const repository: string[] = [];
  const dependents: string[] = [];

  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === 'FirestartrGithubRepository') {
      repository.push(crPath);
    } else {
      dependents.push(crPath);
    }
  }

  if (repository.length === 0) {
    throw new Error(
      'Rendered repository fixture did not include a repository CR',
    );
  }

  return { repository, dependents };
}

async function applyAndWaitRepositoryBatch(
  client: E2EApi,
  label: string,
  crPathsByItem: string[][],
  staggerMs: number,
  disableSleepGuards: boolean,
): Promise<void> {
  const stagedCrPaths = await Promise.all(
    crPathsByItem.map((crPaths) => splitRepositoryCrPaths(crPaths)),
  );

  await applyAndWaitBatch(
    client,
    `${label} repositories`,
    stagedCrPaths.map(({ repository }) => repository),
    staggerMs,
    disableSleepGuards,
  );

  const dependentCrPathsByItem = stagedCrPaths.map(
    ({ dependents }) => dependents,
  );
  if (dependentCrPathsByItem.some((crPaths) => crPaths.length > 0)) {
    await applyAndWaitBatch(
      client,
      `${label} dependents`,
      dependentCrPathsByItem,
      staggerMs,
      disableSleepGuards,
    );
  }
}

async function deleteItemCrPaths(
  client: E2EApi,
  label: string,
  crPaths: string[],
  itemIndex: number,
  itemCount: number,
  timeoutSeconds: number,
): Promise<void> {
  common.logger.info(
    `[massive] ${label}: deleting item ${itemIndex + 1}/${itemCount}`,
  );

  for (const crPath of [...crPaths].reverse()) {
    await client.k8s.deleteCr(crPath, timeoutSeconds);
  }
}

function wrapDeleteItemError(
  error: unknown,
  label: string,
  itemIndex: number,
  itemCount: number,
): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `[massive] ${label}: failed deleting item ${itemIndex + 1}/${itemCount}: ${message}`,
  );
}

async function deleteBatch(
  client: E2EApi,
  label: string,
  crPathsByItem: string[][],
  staggerMs: number,
  timeoutSeconds: number,
  disableSleepGuards: boolean,
): Promise<void> {
  const pendingDeletes: Promise<void>[] = [];

  for (const [index, crPaths] of crPathsByItem.entries()) {
    pendingDeletes.push(
      deleteItemCrPaths(
        client,
        label,
        crPaths,
        index,
        crPathsByItem.length,
        timeoutSeconds,
      ).catch((error: unknown) => {
        throw wrapDeleteItemError(error, label, index, crPathsByItem.length);
      }),
    );

    if (index < crPathsByItem.length - 1) {
      await sleepForGuard(
        `${label}: delete stagger`,
        staggerMs,
        disableSleepGuards,
      );
    }
  }

  let firstError: unknown;
  let hasError = false;
  await Promise.all(
    pendingDeletes.map(async (pendingDelete) => {
      try {
        await pendingDelete;
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    }),
  );

  if (hasError) {
    throw firstError;
  }
}

async function waitForRepositoryAbsence(
  client: E2EApi,
  repositoryName: string,
): Promise<void> {
  await pollUntil(
    () => retryTransientGitHubProbe(() => client.gh.repoExists(repositoryName)),
    {
      timeoutMs: CANARY_DELETE_TIMEOUT_MS,
      intervalMs: CANARY_DELETE_POLL_INTERVAL_MS,
      isDone: (exists) => !exists,
      shouldRetryError: isRetryableError,
      onRetryError: logRetryableGitHubPollError,
      createTimeoutError: () =>
        new Error(
          `[massive] repository ${repositoryName} still exists after ` +
            `${CANARY_DELETE_TIMEOUT_MS}ms`,
        ),
    },
  );
}

async function waitForCanaryRepositoryDeletion(
  client: E2EApi,
  repositoryName: string,
): Promise<void> {
  try {
    await waitForRepositoryAbsence(client, repositoryName);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    common.logger.warn(
      `[massive] canary repository ${repositoryName} was not removed after ` +
        `CR deletion; falling back to direct GitHub cleanup: ${message}`,
    );
  }

  await destroyOrgResources(client, [repositoryName], { strict: true });
  await waitForRepositoryAbsence(client, repositoryName);
}

function fixtureCleanupPlan(
  plan: ReturnType<typeof buildMassivePlan>,
): FixtureResourceInput[] {
  return [
    ...plan.groups.map((group) => ({
      fixtureName: group.fixtureName,
      claimName: group.claimName,
    })),
    ...plan.repositories.map((repository) => ({
      fixtureName: repository.fixtureName,
      claimName: repository.claimName,
    })),
    {
      fixtureName: plan.canary.create.fixtureName,
      claimName: plan.canary.create.claimName,
    },
  ];
}

describeMassiveE2e('Massive creation/deletion GitHub E2E', () => {
  let client: E2EApi;
  let config: ReturnType<typeof parseMassiveConfig>;
  let plan: ReturnType<typeof buildMassivePlan> | undefined;
  const renderedGroups = new Map<string, string[]>();
  const renderedRepos = new Map<string, string[]>();
  let renderedCanary: string[] = [];

  beforeAll(async () => {
    config = parseMassiveConfig();
    client = await initE2e(undefined, undefined, {
      namePrefix: 'massive',
      onlyFiles: ['group_a', 'component_a'],
    });
    plan = buildMassivePlan(
      createNameBuilder(client.getPrefix()).prefix,
      config.repoCount,
      config.groupCount,
    );

    if (config.disableSleepGuards) {
      common.logger.warn(
        '[massive] test-side sleeping guards are disabled; rate-limit guard ' +
          'sleeps, per-item staggers, and batch pauses will be skipped',
      );
    } else {
      common.logger.info('[massive] test-side sleeping guards are enabled');
    }

    await destroyFixtureResources(
      client,
      client.getPrefix(),
      fixtureCleanupPlan(plan),
      {
        strict: true,
        logPrefix: 'massive-pre-clean',
      },
    );
  }, MASSIVE_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!client || !plan) return;

    const cleanup = new CleanupRunner();
    const orgResourceNames = [
      ...plan.groups.map((group) => group.claimName),
      plan.canary.create.claimName,
      ...plan.repositories.map((repository) => repository.claimName),
    ];

    await cleanup.run(
      'cleanup rendered artifacts before org cleanup',
      async () => {
        await cleanupRenderedArtifacts(client);
      },
    );
    await cleanup.run(
      'destroy massive org resources after CR cleanup',
      async () => {
        await destroyOrgResources(client, orgResourceNames, { strict: true });
      },
    );
    await cleanup.run('final massive org resource cleanup pass', async () => {
      await destroyOrgResources(client, orgResourceNames, { strict: true });
    });
    cleanup.warnOnErrors('massive', 'afterAll');
  }, MASSIVE_CLEANUP_TIMEOUT_MS);

  it(
    'creates, reconciles, deletes, and validates canary lifecycle during destruction',
    async () => {
      if (!plan) {
        throw new Error('Massive plan was not initialized');
      }

      const groupBatches = splitBatches(plan.groups, config.groupBatchSize);
      for (const [batchIndex, batch] of groupBatches.entries()) {
        await rateGate(
          client,
          `group-create batch ${batchIndex + 1}`,
          config.minCoreRateRemaining,
          config.rateResetCushionMs,
          config.disableSleepGuards,
        );
        const rendered = [];
        for (const group of batch) {
          const crPaths = await renderGroup(client, group);
          renderedGroups.set(group.claimName, crPaths);
          rendered.push(crPaths);
        }
        await applyAndWaitBatch(
          client,
          `group-create batch ${batchIndex + 1}`,
          rendered,
          config.groupApplyStaggerMs,
          config.disableSleepGuards,
        );
        if (batchIndex < groupBatches.length - 1) {
          await sleepForGuard(
            `group-create batch ${batchIndex + 1}: batch pause`,
            config.groupBatchPauseMs,
            config.disableSleepGuards,
          );
        }
      }

      const repoBatches = splitBatches(plan.repositories, config.repoBatchSize);
      for (const [batchIndex, batch] of repoBatches.entries()) {
        await rateGate(
          client,
          `repo-create batch ${batchIndex + 1}`,
          config.minCoreRateRemaining,
          config.rateResetCushionMs,
          config.disableSleepGuards,
        );
        const rendered = [];
        for (const repository of batch) {
          const crPaths = await renderRepository(client, repository);
          renderedRepos.set(repository.claimName, crPaths);
          rendered.push(crPaths);
        }
        await applyAndWaitRepositoryBatch(
          client,
          `repo-create batch ${batchIndex + 1}`,
          rendered,
          config.repoApplyStaggerMs,
          config.disableSleepGuards,
        );
        if (batchIndex < repoBatches.length - 1) {
          await sleepForGuard(
            `repo-create batch ${batchIndex + 1}: batch pause`,
            config.repoBatchPauseMs,
            config.disableSleepGuards,
          );
        }
      }

      const deleteBatches = splitBatches(
        plan.repositories,
        config.deleteBatchSize,
      );
      const [firstDeleteBatch, ...remainingDeleteBatches] = deleteBatches;
      if (!firstDeleteBatch) {
        throw new Error('No repository batch available for deletion');
      }

      await rateGate(
        client,
        'repo-delete first batch',
        config.minCoreRateRemaining,
        config.rateResetCushionMs,
        config.disableSleepGuards,
      );
      await deleteBatch(
        client,
        'repo-delete first batch',
        firstDeleteBatch.map((repository) =>
          getRenderedCrPaths(renderedRepos, 'repository', repository.claimName),
        ),
        config.deleteStaggerMs,
        REPO_DELETE_WAIT_TIMEOUT_SECONDS,
        config.disableSleepGuards,
      );

      renderedCanary = await renderRepository(client, plan.canary.create);
      await applyAndWaitRepositoryBatch(
        client,
        'destructive-canary create',
        [renderedCanary],
        0,
        config.disableSleepGuards,
      );
      await expect(
        client.gh.repoExists(plan.canary.create.claimName),
      ).resolves.toBe(true);

      renderedCanary = await renderRepository(client, plan.canary.modified);
      await applyAndWaitRepositoryBatch(
        client,
        'destructive-canary modify',
        [renderedCanary],
        0,
        config.disableSleepGuards,
      );
      await expectRepositoryMetadata(client, plan.canary.modified);

      await deleteBatch(
        client,
        'destructive-canary delete',
        [renderedCanary],
        0,
        REPO_DELETE_WAIT_TIMEOUT_SECONDS,
        config.disableSleepGuards,
      );
      await waitForCanaryRepositoryDeletion(
        client,
        plan.canary.create.claimName,
      );

      for (const [batchIndex, batch] of remainingDeleteBatches.entries()) {
        await rateGate(
          client,
          `repo-delete batch ${batchIndex + 2}`,
          config.minCoreRateRemaining,
          config.rateResetCushionMs,
          config.disableSleepGuards,
        );
        await deleteBatch(
          client,
          `repo-delete batch ${batchIndex + 2}`,
          batch.map((repository) =>
            getRenderedCrPaths(
              renderedRepos,
              'repository',
              repository.claimName,
            ),
          ),
          config.deleteStaggerMs,
          REPO_DELETE_WAIT_TIMEOUT_SECONDS,
          config.disableSleepGuards,
        );
        if (batchIndex < remainingDeleteBatches.length - 1) {
          await sleepForGuard(
            `repo-delete batch ${batchIndex + 2}: batch pause`,
            config.deleteBatchPauseMs,
            config.disableSleepGuards,
          );
        }
      }

      const groupDeleteBatches = splitBatches(
        plan.groups,
        config.deleteBatchSize,
      );
      for (const [batchIndex, batch] of groupDeleteBatches.entries()) {
        await rateGate(
          client,
          `group-delete batch ${batchIndex + 1}`,
          config.minCoreRateRemaining,
          config.rateResetCushionMs,
          config.disableSleepGuards,
        );
        await deleteBatch(
          client,
          `group-delete batch ${batchIndex + 1}`,
          batch.map((group) =>
            getRenderedCrPaths(renderedGroups, 'group', group.claimName),
          ),
          config.deleteStaggerMs,
          GROUP_DELETE_WAIT_TIMEOUT_SECONDS,
          config.disableSleepGuards,
        );
        if (batchIndex < groupDeleteBatches.length - 1) {
          await sleepForGuard(
            `group-delete batch ${batchIndex + 1}: batch pause`,
            config.deleteBatchPauseMs,
            config.disableSleepGuards,
          );
        }
      }
    },
    MASSIVE_TEST_TIMEOUT_MS,
  );
});
