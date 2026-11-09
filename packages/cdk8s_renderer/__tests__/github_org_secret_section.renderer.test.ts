import {
  createTestContext,
  RendererTestContext,
  rendererTestFixtures,
} from './auxiliar';

function findOrgSecretSectionCr(
  renderedMap: Record<string, any>,
): any | undefined {
  return Object.values(renderedMap).find(
    (cr: any) => cr.kind === 'FirestartrGithubOrganizationSecretSection',
  );
}

function findAllOrgSecretSectionCrs(renderedMap: Record<string, any>): any[] {
  return Object.values(renderedMap).filter(
    (cr: any) => cr.kind === 'FirestartrGithubOrganizationSecretSection',
  );
}

describe('GitHub organization secret section rendering', () => {
  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({
      onlyFiles: [
        'orgsettings_secrets_a',
        'secret_a',
        'system_a',
        'domain_a',
        'user_a',
        'group_a',
      ],
    });
  });

  afterEach(async () => {
    await context.destroy();
  });

  it('renders SecretSection CR from org_secrets in OrgSettingsClaim', async () => {
    const { renderedMap } = await context.renderClaims(
      {
        claimRefs: ['OrgSettingsClaim-github_org_settings_secrets'],
      },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const cr = findOrgSecretSectionCr(renderedMap);

    expect(cr).toBeDefined();
    expect(cr.spec.org).toBe('firestartr-test-secrets');
    expect(cr.spec.secrets.actions).toHaveLength(2);
    expect(cr.spec.secrets.actions[0]).toMatchObject({
      name: 'MY_SECRET',
      ref: {
        kind: 'Secret',
        name: 'secret-a',
        key: 'rds_conn',
      },
    });
    expect(cr.spec.secrets.actions[1]).toMatchObject({
      name: 'ANOTHER_SECRET',
      ref: {
        kind: 'Secret',
        name: 'secret-a',
        key: 'rds_conn',
      },
    });
    expect(cr.spec.secrets.codespaces).toHaveLength(1);
    expect(cr.spec.secrets.dependabot).toEqual([]);
    expect(cr.metadata.name).toMatch(
      /^firestartr-test-secrets-org-settings-[0-9a-f-]{36}$/,
    );
    expect(cr.spec.firestartr.tfStateKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('renders SecretSection CR with distinct tfStateKey from OrgSettings CR', async () => {
    const { renderedMap } = await context.renderClaims(
      {
        claimRefs: ['OrgSettingsClaim-github_org_settings_secrets'],
      },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const orgSettingsCr = (Object.values(renderedMap) as any[]).find(
      (cr: any) => cr.kind === 'FirestartrGithubOrganizationSettings',
    );
    const secretSectionCr = findOrgSecretSectionCr(renderedMap);

    expect(orgSettingsCr).toBeDefined();
    expect(secretSectionCr).toBeDefined();
    expect(orgSettingsCr.spec.firestartr.tfStateKey).not.toBe(
      secretSectionCr.spec.firestartr.tfStateKey,
    );
  });

  it('keeps the SecretSection CR identity and increments the revision on re-render', async () => {
    const first = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings_secrets'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const firstCr = findOrgSecretSectionCr(first.renderedMap);

    expect(firstCr).toBeDefined();
    expect(firstCr.metadata.annotations['firestartr.dev/revision']).toBe('1');

    const second = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings_secrets'] },
      { crsPath: context.getResourcesOutDir() },
    );

    const secondCr = findOrgSecretSectionCr(second.renderedMap);

    expect(secondCr).toBeDefined();
    expect(secondCr.metadata.name).toBe(firstCr.metadata.name);
    expect(secondCr.spec.firestartr.tfStateKey).toBe(
      firstCr.spec.firestartr.tfStateKey,
    );
    expect(secondCr.metadata.annotations['firestartr.dev/revision']).toBe('2');
  });

  it('allows SecretSection CRs for different orgs', async () => {
    await context.duplicateFile(
      'orgsettings_secrets_a',
      'orgsettings_secrets_b',
    );
    await context.applyPatches('orgsettings_secrets_b', [
      {
        op: 'replace',
        path: '/name',
        value: 'github_org_settings_secrets_b',
      },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-secrets-b-org-settings',
      },
      {
        op: 'replace',
        path: '/providers/github/org',
        value: 'firestartr-test-secrets-b',
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      {
        claimRefs: [
          'OrgSettingsClaim-github_org_settings_secrets',
          'OrgSettingsClaim-github_org_settings_secrets_b',
        ],
      },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const secretSectionCrs = findAllOrgSecretSectionCrs(renderedMap);

    expect(secretSectionCrs).toHaveLength(2);
    expect(secretSectionCrs.map((cr) => cr.spec.org).sort()).toEqual([
      'firestartr-test-secrets',
      'firestartr-test-secrets-b',
    ]);
  });

  it('rejects duplicate SecretSection CRs for same org', async () => {
    await context.duplicateFile(
      'orgsettings_secrets_a',
      'orgsettings_secrets_b',
    );
    await context.applyPatches('orgsettings_secrets_b', [
      {
        op: 'replace',
        path: '/name',
        value: 'github_org_settings_secrets_b',
      },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-secrets-b-org-settings',
      },
      {
        op: 'replace',
        path: '/providers/github/org',
        value: 'firestartr-test-secrets',
      },
    ]);

    await expect(
      context.renderClaims(
        {
          claimRefs: [
            'OrgSettingsClaim-github_org_settings_secrets',
            'OrgSettingsClaim-github_org_settings_secrets_b',
          ],
        },
        { crsPath: rendererTestFixtures.noCrs },
      ),
    ).rejects.toThrow(/Duplicate.*for GitHub organization/);
  });
});
