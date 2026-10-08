import fs from 'node:fs/promises';
import common from 'catalog_common';
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
  type TempOpaqueSecret,
} from '../..';
import { buildComponentClaimPatches } from '../../src/claim-patches';
import { isNotFound, type GithubError } from '../../src/gh/errors';
import {
  prepareWorkflowVerification,
  verifyValueViaWorkflow,
} from '../../src/gh/workflow-verification';
import { isRetryableGitHubError } from '../../src/gh/wait';
import { disableRepositoryAdminEnforcementInManifest } from '../../src/repository-admin-enforcement';
import { pickRenderedCr, setReconcileAt } from '../../src/render-artifacts';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
} from '../../src/utils/async-control';

const REPO_SECRET_NAME = 'E2E_ACTIONS_SECRET';
const REPO_SECRET_KEY = 'repo-secret-key';
const INITIAL_SECRET_VALUE = 'initial-repo-secret';
const ROTATED_SECRET_VALUE = 'rotated-repo-secret';
const REPO_SECRET_READ_TIMEOUT_MS = 5 * 60 * 1000;
const REPO_SECRET_READ_INTERVAL_MS = 5000;
const VERIFY_SECRET_WORKFLOW_FILE_NAME = 'verify-secret.yaml';
const WORKFLOW_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const REPO_SECRETS_TEST_TIMEOUT_MS =
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS + 2 * WORKFLOW_RUN_TIMEOUT_MS;

type SecretManifest = {
  stringData?: Record<string, string>;
};

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
        patches: buildComponentClaimPatches({
          name: componentName,
          ownerRef: defaultGroup.ref,
          secrets: [
            { name: REPO_SECRET_NAME, value: tempSecret.claimSecretRef },
          ],
        }),
      });
      const secretsCrPath = await pickRenderedCr(
        rendered.crPaths,
        'FirestartrGithubRepositorySecretsSection',
      );
      const repositoryCrPath = await pickRenderedCr(
        rendered.crPaths,
        'FirestartrGithubRepository',
      );

      // The verification workflow is committed directly to the protected main
      // branch, so this disposable test repository must not enforce admins.
      await disableRepositoryAdminEnforcementInManifest(repositoryCrPath);

      await applyAndWaitCrPaths(client, rendered.crPaths);

      const initialSecret = await waitForRepoSecret(client.gh, componentName);
      expect(initialSecret.name).toBe(REPO_SECRET_NAME);

      // Commit the verification workflow once, before the first value check,
      // then dispatch it once per value. Teardown deletes the whole repository,
      // so the file needs no cleanup. The handle correlates each run by
      // display_title; the newest run is never assumed to be this test's.
      const org = client.getOrg();
      const verification = await prepareWorkflowVerification({
        org,
        repoName: componentName,
        workflowFixtureFileName: VERIFY_SECRET_WORKFLOW_FILE_NAME,
      });
      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Repository secret',
        valueName: REPO_SECRET_NAME,
        inputValues: {
          secret_name: REPO_SECRET_NAME,
          expected_value: INITIAL_SECRET_VALUE,
        },
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

      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Repository secret',
        valueName: REPO_SECRET_NAME,
        inputValues: {
          secret_name: REPO_SECRET_NAME,
          expected_value: ROTATED_SECRET_VALUE,
        },
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
