import {
  CleanupRunner,
  cleanupRenderedArtifacts,
  initE2e,
  type E2EApi,
} from '../..';
import {
  DEFAULT_E2E_ORG,
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';
import { isRetryableGitHubError } from '../../src/gh/wait';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
} from '../../src/utils/async-control';

import type { GhOrgSettings } from '../../src/types';

const ORG_SETTINGS_FIXTURE = 'orgsettings-a';
const ORG_SETTINGS_READ_BACK_INTERVAL_MS = 5000;

function orgSettingsMatch(
  settings: GhOrgSettings,
  expectedDescription: string,
): boolean {
  return (
    settings.description === expectedDescription &&
    settings.company === 'Prefapp' &&
    settings.hasOrganizationProjects === true
  );
}

async function getOrgSettingsWithRetryableErrors(
  client: E2EApi,
): Promise<GhOrgSettings> {
  try {
    return await client.gh.getOrgSettings();
  } catch (error) {
    if (isRetryableGitHubError(error)) {
      throw createRetryableError(error);
    }

    throw error;
  }
}

// GitHub org settings are a per-org singleton (one FirestartrGithubOrganization-
// Settings per org). This suite runs against the disposable `firestartr-e2e`
// org, so applying then destroying the singleton is safe and no snapshot/restore
// is needed. Create, then delete, must be one serialized lifecycle: both fight
// over the same github_organization_settings resource.
describe('Claim Render Local Org Settings E2E', () => {
  let client: E2EApi;
  let crPath = '';

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-settings-render-apply',
      onlyFiles: [ORG_SETTINGS_FIXTURE],
    });

    if (client.getOrg() !== DEFAULT_E2E_ORG) {
      throw new Error(
        `Org settings e2e must run only against disposable org '${DEFAULT_E2E_ORG}', got '${client.getOrg()}'.`,
      );
    }
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    // The test deletes the CR on success; this only fires if it threw earlier.
    if (crPath) {
      await cleanup.run('delete org settings CR', async () => {
        await client.k8s.deleteCr(crPath, WAIT_FOR_CR_TIMEOUT_SECONDS);
      });
    }

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.warnOnErrors('org-settings-render-apply', 'afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'should render, create, and delete org settings',
    async () => {
      // Run-unique sentinel so the assertion proves reconciliation wrote this
      // value, not a coincidental pre-existing one.
      const description = `E2E org settings ${client.getPrefix()} ${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // org and provider name are auto-patched from the claim taxonomy; only the
      // sentinel description needs an explicit patch.
      const rendered = await client.claims.renderLocally(ORG_SETTINGS_FIXTURE, {
        patches: [
          {
            op: 'replace',
            path: '/providers/github/description',
            value: description,
          },
        ],
      });

      const primaryCrPath = rendered.crPaths[0];
      if (!primaryCrPath) {
        throw new Error('No rendered CR path found for orgsettings-a claim');
      }
      crPath = primaryCrPath;

      // Clean slate in case a previous run crashed after apply. deleteCr is
      // already idempotent for missing resources, so other failures should fail.
      await client.k8s.deleteCr(crPath, WAIT_FOR_CR_TIMEOUT_SECONDS);

      // Create: apply and wait for the operator to reconcile the singleton.
      await client.k8s.applyCr(crPath);
      const result = await client.k8s.waitForCr(
        crPath,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );
      expect(result).toBeDefined();

      // Confirm reconciliation actually pushed the settings to GitHub.
      const settings = await pollUntil(
        () => getOrgSettingsWithRetryableErrors(client),
        {
          timeoutMs: WAIT_FOR_CR_TIMEOUT_SECONDS * 1000,
          intervalMs: ORG_SETTINGS_READ_BACK_INTERVAL_MS,
          isDone: (currentSettings) =>
            orgSettingsMatch(currentSettings, description),
          shouldRetryError: isRetryableError,
          createTimeoutError: (lastSettings) =>
            new Error(
              `Timed out waiting for org settings to match expected values. Last observed: ${JSON.stringify(lastSettings ?? null)}`,
            ),
        },
      );
      expect(settings.description).toBe(description);
      expect(settings.company).toBe('Prefapp');
      expect(settings.hasOrganizationProjects).toBe(true);

      // Delete: deleteCr waits for the finalizer / terraform destroy to finish,
      // which is the delete assertion. Org settings can never be "gone" from
      // GitHub, so there is no remote-absence check.
      await client.k8s.deleteCr(crPath, WAIT_FOR_CR_TIMEOUT_SECONDS);
      crPath = '';
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
