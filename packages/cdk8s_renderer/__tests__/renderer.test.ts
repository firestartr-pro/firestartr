import type { RendererTestContext } from './auxiliar';
import { createTestContext, rendererTestFixtures } from './auxiliar';

describe('CDK8s Renderer', () => {
  jest.setTimeout(30000);

  process.env.ORG = 'firestartr-test';

  let context: RendererTestContext;

  beforeAll(async () => {
    context = await createTestContext({});
  });

  beforeEach(async () => {
    context = await context.resetRendererState();
  });

  afterAll(async () => {
    await context.destroy();
  });

  it('Is able to render charts', async () => {
    await context.removeFile('user_a');

    await expect(
      context.renderClaims(undefined, { excludeGithubCrs: true }),
    ).rejects.toMatch(/UserClaim-user_a/);
  });

  it('Is able to render catalog entities', async () => {
    const nContext = await createTestContext({
      paths: ['systems', 'domains', 'users'],
    });

    try {
      const { catalogApp, app } = await nContext.renderClaims();

      expect(app.charts.length).toBe(1);
      expect(catalogApp.charts.length).toBe(3);
    } finally {
      await nContext.destroy();
    }
  });

  it('Is able to detect missing dependencies in claims', async () => {
    const nContext = await createTestContext({
      paths: ['components'],
    });

    try {
      await expect(nContext.renderClaims()).rejects.toMatch(
        /SystemClaim-system_a not found/,
      );
    } finally {
      await nContext.destroy();
    }
  });

  it('Is able to detect repeated tfStateKeys', async () => {
    await context.applyPatches('workspace_a', [
      {
        op: 'add',
        path: '/providers/terraform/tfStateKey',
        value: 'ff5a88c7-f876-4f3a-8aa8-5b78f4aeaa54',
      },
    ]);

    await context.applyPatches('workspace_b', [
      {
        op: 'add',
        path: '/providers/terraform/tfStateKey',
        value: 'ff5a88c7-f876-4f3a-8aa8-5b78f4aeaa54',
      },
    ]);

    await expect(
      context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        'Check the following Claims to ensure that the tfStateKey is unique',
      ),
    });
  });

  it('Is able to detect missconfiguration between policy and syncpolicy', async () => {
    await context.applyPatches('workspace_b', [
      {
        op: 'replace',
        path: '/providers/terraform/sync/enabled',
        value: true,
      },
    ]);

    await expect(
      context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs }),
    ).rejects.toMatch(
      /incompatible policies 'observe' and 'apply' for FirestartrTerraformWorkspace/,
    );
  });

  it('Is able to render nested groups', async () => {
    const nContext = await createTestContext({
      onlyFiles: ['group_a', 'group_b', 'group_c', 'user_a'],
    });

    try {
      const { renderedMap } = await nContext.renderClaims(undefined, {
        crsPath: rendererTestFixtures.noCrs,
      });

      const getByExternalName = (externalName: string) =>
        Object.values(renderedMap).find(
          (cr: any) =>
            cr.metadata.annotations['firestartr.dev/external-name'] ===
            externalName,
        ) as any;

      const crGroupA = getByExternalName('group-a');
      const crGroupB = getByExternalName('group-b');
      const crGroupC = getByExternalName('group-c');

      expect(crGroupA.spec.parentTeam).toBeUndefined();
      expect(crGroupB.spec.parentTeam.ref.name.includes('a-')).toBe(true);
      expect(crGroupC.spec.parentTeam.ref.name.includes('b-')).toBe(true);
    } finally {
      await nContext.destroy();
    }
  });

  it('Is able to render secret claims', async () => {
    await expect(
      context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs }),
    ).resolves.toBeDefined();
  });

  it('Is able to render secret claims with complex keys', async () => {
    await context.applyPatches('secret_a', [
      {
        op: 'replace',
        path: '/providers/external_secrets/externalSecrets/secrets',
        value: [
          {
            secretName: 'rds_conn',
            remoteRef: '/firestartr/firestartr-test/fs-firestartr-test/pem',
          },
        ],
      },
    ]);

    await expect(
      context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs }),
    ).resolves.toBeDefined();
  });

  it('Is able to render secret without pushSecrets', async () => {
    await context.applyPatches('secret_a', [
      {
        op: 'remove',
        path: '/providers/external_secrets/pushSecrets',
      },
    ]);

    await expect(
      context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs }),
    ).resolves.toBeDefined();
  });

  it('Is able to render secret without externalSecrets', async () => {
    await context.applyPatches('secret_a', [
      {
        op: 'remove',
        path: '/providers/external_secrets/externalSecrets',
      },
    ]);

    await expect(
      context.renderClaims(
        { claimRefs: ['SecretsClaim-secret_a'] },
        { crsPath: rendererTestFixtures.noCrs },
      ),
    ).resolves.toBeDefined();
  });

  it('Is able to render OrgWebhook claims', async () => {
    await context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs });

    const cr = await context.getRenderedCR(
      'FirestartrGithubOrgWebhook',
      'my-github-org-webhook',
    );

    expect(cr).toBeDefined();

    expect(
      await context.testRenderedCR('FirestartrGithubOrgWebhook', 'my-github-org-webhook', {
        op: 'test',
        path: '/spec/webhook/secretRef',
        value: {
          kind: 'Secret',
          name: 'secret_a',
          key: 'rds_conn',
        },
      }),
    ).toBe(true);
  });

  it('Is able to render specific claims with specific values', async () => {
    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providers/github/archiveOnDestroy',
        value: false,
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['ComponentClaim-component_a'] },
      { excludeGithubCrs: true },
    );

    expect(renderedMap['Component-component-a']).toBeDefined();
    expect(
      await context.testRenderedCR('FirestartrGithubRepository', 'component-a', {
        op: 'test',
        path: '/spec/repo/archiveOnDestroy',
        value: false,
      }),
    ).toBe(true);
  });

  it("Throws an error when a file surpasses Kubernetes' file size limit (1.5MB)", async () => {
    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providers/github/description',
        value: 'a'.repeat(2 * 1024 * 1024),
      },
    ]);

    await expect(
      context.renderClaims(
        { claimRefs: ['ComponentClaim-component_a'] },
        { excludeGithubCrs: true },
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/exceeds the Kubernetes object size/i),
    });
  });

  it("Throws an error when Component's permissions are duplicated ", async () => {
    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providers/github/overrides/additionalWriters',
        value: ['group:group_a'],
      },
    ]);

    await expect(
      context.renderClaims(
        { claimRefs: ['ComponentClaim-component_a'] },
        { excludeGithubCrs: true },
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Conflicting permission role/i),
    });
  });

  it('validates and normalizes sync annotations', async () => {
    await context.applyPatches('workspace_a', [
      {
        op: 'replace',
        path: '/providers/terraform/sync',
        value: {
          enabled: true,
          schedule: '*/15 * * * * *',
        },
      },
    ]);

    await context.renderClaims(
      { claimRefs: ['TFWorkspaceClaim-workspace_a'] },
      { excludeGithubCrs: true },
    );

    expect(
      await context.testRenderedCR('FirestartrTerraformWorkspace', 'wp-a', {
        op: 'test',
        path: '/metadata/annotations/firestartr.dev~1sync-enabled',
        value: 'true',
      }),
    ).toBe(true);

    expect(
      await context.testRenderedCR('FirestartrTerraformWorkspace', 'wp-a', {
        op: 'test',
        path: '/metadata/annotations/firestartr.dev~1sync-schedule',
        value: '*/15 * * * * *',
      }),
    ).toBe(true);

    expect(
      await context.testRenderedCR('FirestartrTerraformWorkspace', 'wp-a', {
        op: 'test',
        path: '/metadata/annotations/firestartr.dev~1sync-schedule-timezone',
        value: 'Europe/Madrid',
      }),
    ).toBe(true);
  });

  it('is able to render a RepoSecretsSection', async () => {
    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providers/github/secrets',
        value: {
          actions: [
            {
              name: 'FOO',
              value: 'ref:secretsclaim:secret_a:rds_conn',
            },
          ],
        },
      },
    ]);

    await expect(
      context.renderClaims(
        { claimRefs: ['ComponentClaim-component_a'] },
        { excludeGithubCrs: true },
      ),
    ).resolves.toBeDefined();
  });

  it("is able to control the sync section's definition as a whole", async () => {
    const nContext = await createTestContext({
      onlyFiles: [
        'workspace_b',
        'system_a',
        'domain_a',
        'group_a',
        'user_a',
        'secret_a',
      ],
    });

    try {
      await nContext.applyPatches('workspace_b', [
        {
          op: 'replace',
          path: '/providers/terraform/sync',
          value: {
            enabled: true,
            schedule: '@minutely',
          },
        },
      ]);

      nContext.createInitializers({
        TFWorkspaceClaim: {
          providers: {
            terraform: {
              sync: {
                enabled: true,
                period: '24h',
                policy: 'apply',
              },
            },
          },
        },
      });

      await nContext.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-workspace_b'] },
        { excludeGithubCrs: true },
      );

      expect(
        await nContext.testRenderedCR('FirestartrTerraformWorkspace', 'test-a', {
          op: 'test',
          path: '/metadata/annotations/firestartr.dev~1sync-enabled',
          value: 'true',
        }),
      ).toBe(true);
    } finally {
      await nContext.destroy();
    }
  });

  it('is able to render a claimsecret ref in the TFWorkspace', async () => {
    await context.applyPatches('workspace_a', [
      {
        op: 'replace',
        path: '/providers/terraform/values',
        value: {
          secret: 'ref:secretsclaim:secret_a:rds_conn',
        },
      },
    ]);

    await context.renderClaims(
      { claimRefs: ['TFWorkspaceClaim-workspace_a'] },
      { excludeGithubCrs: true },
    );

    expect(
      await context.testRenderedCR('FirestartrTerraformWorkspace', 'wp-a', {
        op: 'test',
        path: '/spec/references/0',
        value: {
          name: 'secret-ref-0',
          ref: {
            kind: 'Secret',
            name: 'secret_a',
            key: 'rds_conn',
          },
        },
      }),
    ).toBe(true);
  });

  it('is able to render a Nobody group with no description', async () => {
    await context.applyPatches('group_a', [
      {
        op: 'remove',
        path: '/description',
      },
      {
        op: 'replace',
        path: '/name',
        value: 'nobody',
      },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'nobody',
      },
    ]);

    await expect(
      context.renderClaims(
        { claimRefs: ['GroupClaim-nobody'] },
        { excludeGithubCrs: true },
      ),
    ).resolves.toBeDefined();
  });
});
