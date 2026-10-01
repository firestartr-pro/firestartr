import {
  CleanupRunner,
  cleanupRenderedArtifacts,
  createNameBuilder,
  createTempOpaqueSecret,
  destroyFixtureResources,
  ensureDefaultGroup,
  initE2e,
  type E2EApi,
  type TempOpaqueSecret,
  waitForOrgWebhookState,
} from '../..';
import {
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';

const ORG_WEBHOOK_FIXTURE = 'orgwebhook-a';
const ORG_WEBHOOK_SECRET_KEY = 'webhook-secret-key';

// Full org-webhook lifecycle example: render with runtime-only values, create
// the remote webhook, then delete the CR and verify the remote object is gone.
describe('Claim Render Local Org Webhook E2E', () => {
  let client: E2EApi;
  let webhookUrl = '';
  let tempSecret: TempOpaqueSecret | null = null;

  beforeAll(async () => {
    // Only the default group fixture is needed up front for the webhook owner.
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-webhook-render-apply',
      onlyFiles: ['firestartr'],
    });

    // Keep the URL deterministic so cleanup can target the same GitHub webhook.
    const nameBuilder = createNameBuilder(client.getPrefix());
    webhookUrl = `https://example.com/hooks/${nameBuilder.build('org-webhook')}`;

    await destroyFixtureResources(
      client,
      client.getPrefix(),
      [ORG_WEBHOOK_FIXTURE],
      {
        logPrefix: 'org-webhook-render-apply',
        // Webhook cleanup needs the runtime URL to find the remote object.
        orgWebhookUrls: [webhookUrl],
        strict: true,
      },
    );
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    // Teardown has several independent steps; keep running all of them.
    const cleanup = new CleanupRunner();

    if (tempSecret) {
      await cleanup.run('dispose temp secret', async () => {
        await tempSecret?.dispose();
      });
    }

    await cleanup.run('destroy org webhook fixture resources', async () => {
      await destroyFixtureResources(
        client,
        client.getPrefix(),
        [ORG_WEBHOOK_FIXTURE],
        {
          logPrefix: 'org-webhook-render-apply-afterall',
          orgWebhookUrls: webhookUrl ? [webhookUrl] : [],
          strict: true,
        },
      );
    });

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.warnOnErrors('org-webhook-render-apply', 'afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'should render, create, and delete an org webhook',
    async () => {
      // Org webhooks must point at a real owner group that already exists.
      const defaultGroup = await ensureDefaultGroup(client);
      const nameBuilder = createNameBuilder(client.getPrefix());

      // The claim references a Kubernetes Secret, so create and apply it first.
      tempSecret = await createTempOpaqueSecret(client, {
        name: nameBuilder.build('org-webhook-secret'),
        key: ORG_WEBHOOK_SECRET_KEY,
      });

      await tempSecret.apply();

      // Patch the base fixture with runtime-owned references and ephemeral test
      // values.
      const rendered = await client.claims.renderLocally(ORG_WEBHOOK_FIXTURE, {
        patches: [
          { op: 'replace', path: '/owner', value: defaultGroup.ref },
          { op: 'remove', path: '/system' },
          {
            op: 'replace',
            path: '/providers/github/webhook/url',
            value: webhookUrl,
          },
          {
            op: 'replace',
            path: '/providers/github/webhook/secretRef',
            value: tempSecret.claimSecretRef,
          },
        ],
      });

      // Org webhook fixtures render a single CR, so apply that manifest.
      const primaryCrPath = rendered.crPaths[0];
      if (!primaryCrPath) {
        throw new Error('No rendered CR path found for orgwebhook-a claim');
      }

      // Verify the CR becomes healthy locally before checking GitHub state.
      await client.k8s.applyCr(primaryCrPath);
      const result = await client.k8s.waitForCr(
        primaryCrPath,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );
      expect(result).toBeDefined();

      // Confirm reconciliation also created the remote GitHub webhook.
      await waitForOrgWebhookState(client, webhookUrl, true);

      // Deleting the CR should remove the provider-owned webhook as well.
      await client.k8s.deleteCr(primaryCrPath, WAIT_FOR_CR_TIMEOUT_SECONDS);
      await waitForOrgWebhookState(client, webhookUrl, false);
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
