import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import common from 'catalog_common';
import github from 'github';
import type { WorkflowCompletionResult } from 'github';
import {
  CleanupRunner,
  applyAndWaitCrPaths,
  cleanupRenderedArtifacts,
  createNameBuilder,
  createTempOpaqueSecret,
  destroyFixtureResources,
  ensureDefaultGroup,
  initE2e,
  type E2EApi,
  type FixtureResourceInput,
  type GhApi,
  type JsonPatchOperation,
  type TempOpaqueSecret,
} from '../..';
import { readK8sResource } from '../../src/cr-finder';
import { resolveE2eFixturesPath } from '../../src/fixtures-path';
import { isNotFound, type GithubError } from '../../src/gh/errors';
import { isRetryableGitHubError } from '../../src/gh/wait';
import { disableRepositoryAdminEnforcementInManifest } from '../../src/repository-admin-enforcement';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
  retryAsync,
} from '../../src/utils/async-control';

const REPO_SECRET_NAME = 'E2E_ACTIONS_SECRET';
const REPO_SECRET_KEY = 'repo-secret-key';
const INITIAL_SECRET_VALUE = 'initial-repo-secret';
const ROTATED_SECRET_VALUE = 'rotated-repo-secret';
const RECONCILE_AT_ANNOTATION =
  common.generic.getFirestartrAnnotation('reconcile-at');
const REPO_SECRET_READ_TIMEOUT_MS = 5 * 60 * 1000;
const REPO_SECRET_READ_INTERVAL_MS = 5000;
const VERIFY_SECRET_WORKFLOW_FILE_NAME = 'verify-secret.yaml';
const VERIFY_SECRET_WORKFLOW_REPO_PATH = `.github/workflows/${VERIFY_SECRET_WORKFLOW_FILE_NAME}`;
const WORKFLOW_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const WORKFLOW_RUN_POLL_INTERVAL_MS = 10000;
const GITHUB_WRITE_RETRY_ATTEMPTS = 5;
const GITHUB_WRITE_RETRY_DELAY_MS = 5000;
const REPO_SECRETS_TEST_TIMEOUT_MS =
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS + 2 * WORKFLOW_RUN_TIMEOUT_MS;

type SecretManifest = {
  stringData?: Record<string, string>;
};

function componentPatches(
  ownerRef: string,
  secretRef: string,
): JsonPatchOperation[] {
  return [
    { op: 'remove', path: '/system' },
    { op: 'replace', path: '/owner', value: ownerRef },
    { op: 'replace', path: '/platformOwner', value: ownerRef },
    { op: 'remove', path: '/maintainedBy' },
    { op: 'replace', path: '/providers/github/additionalRules', value: [] },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalAdmins',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalMaintainers',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalReaders',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalWriters',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalCodeownersRules',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/useDefault',
      value: true,
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/includeClaimKeys',
      value: [],
    },
    {
      op: 'add',
      path: '/providers/github/secrets',
      value: {
        actions: [{ name: REPO_SECRET_NAME, value: secretRef }],
      },
    },
  ];
}

async function findRepoSecretsCrPath(crPaths: string[]): Promise<string> {
  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === 'FirestartrGithubRepositorySecretsSection') {
      return crPath;
    }
  }

  throw new Error(
    'Expected rendered component to include a repository secrets section CR',
  );
}

async function findRepositoryCrPath(crPaths: string[]): Promise<string> {
  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === 'FirestartrGithubRepository') {
      return crPath;
    }
  }

  throw new Error('Expected rendered component to include a repository CR');
}

async function updatePlainSecret(
  tempSecret: TempOpaqueSecret,
  value: string,
): Promise<void> {
  const content = await fs.readFile(tempSecret.manifestPath, 'utf-8');
  const manifest = common.io.fromYaml(content) as SecretManifest;
  if (!manifest.stringData) {
    throw new Error(`Secret manifest has no stringData: ${tempSecret.name}`);
  }

  manifest.stringData[tempSecret.key] = value;
  await fs.writeFile(
    tempSecret.manifestPath,
    common.io.toYaml(manifest),
    'utf-8',
  );
  await tempSecret.apply();
}

async function setReconcileAt(crPath: string): Promise<void> {
  const content = await fs.readFile(crPath, 'utf-8');
  const resource = common.io.fromYaml(content) as {
    metadata?: {
      annotations?: Record<string, string>;
    };
  };
  resource.metadata = resource.metadata ?? {};
  resource.metadata.annotations = {
    ...(resource.metadata.annotations ?? {}),
    [RECONCILE_AT_ANNOTATION]: new Date().toISOString(),
  };
  await fs.writeFile(crPath, common.io.toYaml(resource), 'utf-8');
}

async function readRepoSecretIfAvailable(
  gh: GhApi,
  repoName: string,
): Promise<Awaited<ReturnType<GhApi['getRepoSecret']>> | null> {
  try {
    return await gh.getRepoSecret(repoName, REPO_SECRET_NAME);
  } catch (error) {
    if (isNotFound(error as GithubError)) {
      return null;
    }

    if (isRetryableGitHubError(error)) {
      throw createRetryableError(error);
    }

    throw error;
  }
}

async function waitForRepoSecret(
  gh: GhApi,
  repoName: string,
): Promise<Awaited<ReturnType<GhApi['getRepoSecret']>>> {
  const secret = await pollUntil(
    () => readRepoSecretIfAvailable(gh, repoName),
    {
      timeoutMs: REPO_SECRET_READ_TIMEOUT_MS,
      intervalMs: REPO_SECRET_READ_INTERVAL_MS,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for ${repoName}/${REPO_SECRET_NAME} to exist`,
        ),
    },
  );

  if (secret === null) {
    throw new Error(`Expected ${repoName}/${REPO_SECRET_NAME} to exist`);
  }

  return secret;
}

async function waitForRepoSecretUpdate(
  gh: GhApi,
  repoName: string,
  baselineUpdatedAt: string,
): Promise<Awaited<ReturnType<GhApi['getRepoSecret']>>> {
  const baselineTime = Date.parse(baselineUpdatedAt);
  if (Number.isNaN(baselineTime)) {
    throw new Error(
      `Invalid baseline updatedAt for ${repoName}/${REPO_SECRET_NAME}: ${baselineUpdatedAt}`,
    );
  }

  const secret = await pollUntil(
    () => readRepoSecretIfAvailable(gh, repoName),
    {
      timeoutMs: REPO_SECRET_READ_TIMEOUT_MS,
      intervalMs: REPO_SECRET_READ_INTERVAL_MS,
      isDone: (value) => {
        if (value === null) {
          return false;
        }

        const updatedTime = Date.parse(value.updatedAt);
        if (Number.isNaN(updatedTime)) {
          throw new Error(
            `Invalid updatedAt for ${repoName}/${REPO_SECRET_NAME}: ${value.updatedAt}`,
          );
        }

        return updatedTime > baselineTime;
      },
      shouldRetryError: isRetryableError,
      createTimeoutError: (lastValue) =>
        new Error(
          `Timed out waiting for ${repoName}/${REPO_SECRET_NAME} updatedAt to advance past ${baselineUpdatedAt}; last value was ${lastValue?.updatedAt ?? 'unavailable'}`,
        ),
    },
  );

  if (secret === null) {
    throw new Error(`Expected ${repoName}/${REPO_SECRET_NAME} to exist`);
  }

  return secret;
}

// =============================================================================
// Workflow-based secret value verification
//
// GitHub never returns a repository secret's value, so exact equality is
// asserted inside the disposable repository itself: a workflow_dispatch
// workflow compares the provisioned secret with the expected value and the
// run's conclusion becomes the authoritative value assertion. Runs are
// correlated by a unique id surfaced as the run's display_title; the newest
// run is never assumed to belong to this test.
// =============================================================================

type OrgOctokit = Awaited<ReturnType<typeof github.getOctokitForOrg>>;

type WorkflowRunListItem = {
  id: number;
  display_title?: string | null;
};

type WorkflowRunCompletion = Pick<
  WorkflowCompletionResult,
  'conclusion' | 'runId' | 'htmlUrl'
>;

function selectCorrelatedWorkflowRun<Run extends WorkflowRunListItem>(
  runs: Run[],
  correlationId: string,
): Run | null {
  return runs.find((run) => run.display_title === correlationId) ?? null;
}

function assertWorkflowRunSucceeded(
  completion: WorkflowRunCompletion,
  context: { repoName: string; secretName: string; correlationId: string },
): void {
  if (completion.conclusion === 'success') {
    return;
  }

  throw new Error(
    'Repository secret value verification failed for ' +
      `${context.repoName}/${context.secretName} ` +
      `(correlation ${context.correlationId}): workflow run ` +
      `${completion.runId} concluded with ` +
      `'${completion.conclusion ?? 'none'}'. Run URL: ${completion.htmlUrl}`,
  );
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

async function writeVerifySecretWorkflow(
  repoName: string,
  org: string,
): Promise<void> {
  const fixturePath = path.join(
    resolveE2eFixturesPath(),
    'workflows',
    VERIFY_SECRET_WORKFLOW_FILE_NAME,
  );
  const workflowContent = await fs.readFile(fixturePath, 'utf-8');

  await retryAsync(
    () =>
      github.repo.setContent(
        VERIFY_SECRET_WORKFLOW_REPO_PATH,
        workflowContent,
        repoName,
        org,
        'main',
        'test: add repository secret verification workflow',
      ),
    {
      attempts: GITHUB_WRITE_RETRY_ATTEMPTS,
      shouldRetry: (error) => isRetryableGitHubError(error),
      getDelayMs: () => GITHUB_WRITE_RETRY_DELAY_MS,
    },
  );
}

async function waitForRegisteredWorkflowId(
  octokit: OrgOctokit,
  org: string,
  repoName: string,
): Promise<number> {
  const workflow = await pollUntil(
    () =>
      retryTransientGitHubProbe(async () => {
        const response = await octokit.rest.actions.listRepoWorkflows({
          owner: org,
          repo: repoName,
          per_page: 100,
        });
        const workflows = response.data.workflows as {
          id: number;
          path: string;
        }[];
        return (
          workflows.find(
            (candidate) => candidate.path === VERIFY_SECRET_WORKFLOW_REPO_PATH,
          ) ?? null
        );
      }),
    {
      timeoutMs: REPO_SECRET_READ_TIMEOUT_MS,
      intervalMs: REPO_SECRET_READ_INTERVAL_MS,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for ${VERIFY_SECRET_WORKFLOW_REPO_PATH} to be discoverable in ${org}/${repoName}`,
        ),
    },
  );

  if (workflow === null) {
    throw new Error(
      `Expected ${VERIFY_SECRET_WORKFLOW_REPO_PATH} to be discoverable in ${org}/${repoName}`,
    );
  }

  return workflow.id;
}

async function waitForCorrelatedWorkflowRun(
  octokit: OrgOctokit,
  org: string,
  repoName: string,
  workflowId: number,
  correlationId: string,
  timeoutMs: number,
): Promise<WorkflowRunListItem> {
  const run = await pollUntil(
    () =>
      retryTransientGitHubProbe(async () => {
        const response = await octokit.rest.actions.listWorkflowRuns({
          owner: org,
          repo: repoName,
          workflow_id: workflowId,
          per_page: 100,
        });
        return selectCorrelatedWorkflowRun(
          response.data.workflow_runs as WorkflowRunListItem[],
          correlationId,
        );
      }),
    {
      timeoutMs,
      intervalMs: REPO_SECRET_READ_INTERVAL_MS,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for a ${VERIFY_SECRET_WORKFLOW_FILE_NAME} run ` +
            `with display_title '${correlationId}' in ${org}/${repoName}`,
        ),
    },
  );

  if (run === null) {
    throw new Error(
      `Expected a ${VERIFY_SECRET_WORKFLOW_FILE_NAME} run with ` +
        `display_title '${correlationId}' in ${org}/${repoName}`,
    );
  }

  return run;
}

async function verifyRepoSecretValue(options: {
  octokit: OrgOctokit;
  org: string;
  repoName: string;
  workflowId: number;
  expectedValue: string;
}): Promise<void> {
  const { octokit, org, repoName, workflowId, expectedValue } = options;
  const correlationId = randomUUID();

  // Dispatched exactly once: failed or timed-out runs surface as test
  // failures rather than being redispatched automatically.
  await github.workflow.triggerWorkflow(
    org,
    repoName,
    workflowId,
    'main',
    {
      secret_name: REPO_SECRET_NAME,
      expected_value: expectedValue,
      correlation_id: correlationId,
    },
    octokit,
  );

  // Correlation and completion share the five-minute per-run budget.
  const deadlineMs = Date.now() + WORKFLOW_RUN_TIMEOUT_MS;
  const run = await waitForCorrelatedWorkflowRun(
    octokit,
    org,
    repoName,
    workflowId,
    correlationId,
    Math.max(deadlineMs - Date.now(), 1),
  );
  const completion = await github.workflow.waitForWorkflowCompletion(
    org,
    repoName,
    run.id,
    Math.max(deadlineMs - Date.now(), 1),
    WORKFLOW_RUN_POLL_INTERVAL_MS,
    octokit,
  );

  assertWorkflowRunSucceeded(completion, {
    repoName,
    secretName: REPO_SECRET_NAME,
    correlationId,
  });
}

describe('Claim Render Local Component Repository Secrets E2E', () => {
  let client: E2EApi;
  let tempSecret: TempOpaqueSecret | null = null;
  let fixtures: FixtureResourceInput[] = [];
  let componentName = '';
  let defaultGroupName = '';

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'component-repo-secrets',
      onlyFiles: ['firestartr', 'component_a'],
    });

    const nameBuilder = createNameBuilder(client.getPrefix());
    defaultGroupName = nameBuilder.build('default-group');
    componentName = nameBuilder.build('component-a');
    fixtures = [
      { fixtureName: 'firestartr', claimName: defaultGroupName },
      { fixtureName: 'component-a', claimName: componentName },
    ];

    await destroyFixtureResources(client, client.getPrefix(), fixtures, {
      logPrefix: 'component-repo-secrets',
      strict: true,
    });
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    if (tempSecret) {
      await cleanup.run('dispose plain repository secret', async () => {
        await tempSecret?.dispose();
      });
    }

    await cleanup.run(
      'destroy repository secrets fixture resources',
      async () => {
        await destroyFixtureResources(client, client.getPrefix(), fixtures, {
          logPrefix: 'component-repo-secrets-afterall',
          strict: true,
        });
      },
    );

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.warnOnErrors('component-repo-secrets', 'afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'provisions a repository Actions secret and verifies its exact value before and after rotation',
    async () => {
      const defaultGroup = await ensureDefaultGroup(client);
      const nameBuilder = createNameBuilder(client.getPrefix());

      tempSecret = await createTempOpaqueSecret(client, {
        name: nameBuilder.build('repo-secret'),
        key: REPO_SECRET_KEY,
        value: INITIAL_SECRET_VALUE,
      });
      await tempSecret.apply();

      // The renderer validates secret refs against SecretsClaim metadata. Keep
      // that metadata in the render context without applying ExternalSecrets.
      await client.claims.patchContextFile('secret-a', [
        { op: 'replace', path: '/name', value: tempSecret.name },
        { op: 'remove', path: '/system' },
        { op: 'replace', path: '/owner', value: defaultGroup.ref },
        {
          op: 'replace',
          path: '/providers/external_secrets/externalSecrets/secrets',
          value: [{ secretName: tempSecret.key, remoteRef: tempSecret.key }],
        },
      ]);

      const rendered = await client.claims.renderLocally('component-a', {
        patches: componentPatches(defaultGroup.ref, tempSecret.claimSecretRef),
      });
      const secretsCrPath = await findRepoSecretsCrPath(rendered.crPaths);
      const repositoryCrPath = await findRepositoryCrPath(rendered.crPaths);

      // The verification workflow is committed directly to the protected main
      // branch, so this disposable test repository must not enforce admins.
      await disableRepositoryAdminEnforcementInManifest(repositoryCrPath);

      await applyAndWaitCrPaths(client, rendered.crPaths);

      const initialSecret = await waitForRepoSecret(client.gh, componentName);
      expect(initialSecret.name).toBe(REPO_SECRET_NAME);

      // Commit the verification workflow once, before the first value check.
      // Teardown deletes the whole repository, so the file needs no cleanup.
      const org = client.getOrg();
      const octokit = await github.getOctokitForOrg(org);
      await writeVerifySecretWorkflow(componentName, org);
      const workflowId = await waitForRegisteredWorkflowId(
        octokit,
        org,
        componentName,
      );
      await verifyRepoSecretValue({
        octokit,
        org,
        repoName: componentName,
        workflowId,
        expectedValue: INITIAL_SECRET_VALUE,
      });

      await updatePlainSecret(tempSecret, ROTATED_SECRET_VALUE);
      await setReconcileAt(secretsCrPath);
      await client.k8s.applyCr(secretsCrPath);

      // updated_at advancing is only a readiness signal for the rotation; the
      // authoritative value assertion is the workflow run below.
      const updatedSecret = await waitForRepoSecretUpdate(
        client.gh,
        componentName,
        initialSecret.updatedAt,
      );
      expect(updatedSecret.name).toBe(REPO_SECRET_NAME);
      expect(Date.parse(updatedSecret.updatedAt)).toBeGreaterThan(
        Date.parse(initialSecret.updatedAt),
      );

      await verifyRepoSecretValue({
        octokit,
        org,
        repoName: componentName,
        workflowId,
        expectedValue: ROTATED_SECRET_VALUE,
      });
    },
    REPO_SECRETS_TEST_TIMEOUT_MS,
  );
});

describe('Repository secret update polling', () => {
  it('rejects an invalid baseline timestamp before polling', async () => {
    const getRepoSecret = jest.fn();
    const gh = { getRepoSecret } as unknown as GhApi;

    await expect(
      waitForRepoSecretUpdate(gh, 'repo-a', 'not-a-timestamp'),
    ).rejects.toThrow('Invalid baseline updatedAt');
    expect(getRepoSecret).not.toHaveBeenCalled();
  });

  it('rejects an invalid observed timestamp immediately', async () => {
    const getRepoSecret = jest.fn().mockResolvedValue({
      name: REPO_SECRET_NAME,
      updatedAt: 'not-a-timestamp',
    });
    const gh = { getRepoSecret } as unknown as GhApi;

    await expect(
      waitForRepoSecretUpdate(gh, 'repo-a', '2026-07-17T09:00:00Z'),
    ).rejects.toThrow('Invalid updatedAt');
  });
});

describe('Correlated workflow run selection', () => {
  const runs = [
    { id: 3, display_title: 'unrelated-run' },
    { id: 2, display_title: 'correlation-id-b' },
    { id: 1, display_title: 'correlation-id-a' },
  ];

  it('returns the run whose display title matches the correlation id', () => {
    expect(selectCorrelatedWorkflowRun(runs, 'correlation-id-a')).toEqual({
      id: 1,
      display_title: 'correlation-id-a',
    });
  });

  it('does not assume the newest run belongs to this test', () => {
    expect(selectCorrelatedWorkflowRun(runs, 'correlation-id-b')?.id).toBe(2);
  });

  it('returns null when no run carries the correlation id', () => {
    expect(selectCorrelatedWorkflowRun(runs, 'missing-id')).toBeNull();
    expect(selectCorrelatedWorkflowRun([], 'correlation-id-a')).toBeNull();
  });
});

describe('Workflow run conclusion assertion', () => {
  const context = {
    repoName: 'repo-a',
    secretName: REPO_SECRET_NAME,
    correlationId: 'correlation-id-a',
  };

  it('does not throw when the run concluded successfully', () => {
    expect(() =>
      assertWorkflowRunSucceeded(
        {
          conclusion: 'success',
          runId: 123,
          htmlUrl: 'https://example.test/runs/123',
        },
        context,
      ),
    ).not.toThrow();
  });

  it.each(['failure', 'cancelled', 'timed_out', null])(
    'throws with run id and URL when the conclusion is %s',
    (conclusion) => {
      expect(() =>
        assertWorkflowRunSucceeded(
          {
            conclusion,
            runId: 456,
            htmlUrl: 'https://example.test/runs/456',
          },
          context,
        ),
      ).toThrow(
        /repo-a\/E2E_ACTIONS_SECRET.*run 456.*https:\/\/example\.test\/runs\/456/,
      );
    },
  );
});
