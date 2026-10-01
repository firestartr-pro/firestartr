import {
  createTestContext,
  RendererTestContext,
  rendererTestFixtures,
} from './auxiliar';

function findOrgSettingsCr(renderedMap: Record<string, any>): any | undefined {
  return Object.values(renderedMap).find(
    (cr: any) => cr.kind === 'FirestartrGithubOrganizationSettings',
  );
}

function findAllOrgSettingsCrs(renderedMap: Record<string, any>): any[] {
  return Object.values(renderedMap).filter(
    (cr: any) => cr.kind === 'FirestartrGithubOrganizationSettings',
  );
}

describe('GitHub organization settings rendering', () => {
  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({ onlyFiles: ['orgsettings_a'] });
  });

  afterEach(async () => {
    await context.destroy();
  });

  it('renders all supported provider fields to FirestartrGithubOrganizationSettings', async () => {
    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const cr = findOrgSettingsCr(renderedMap);

    expect(cr).toBeDefined();
    expect(cr.metadata.name).toMatch(
      /^firestartr-test-org-settings-[0-9a-f-]{36}$/,
    );
    expect(cr.metadata.labels['claim-ref']).toBe('github-org-settings');
    expect(cr.metadata.annotations['firestartr.dev/claim-ref']).toBe(
      'OrgSettingsClaim/github_org_settings',
    );
    expect(cr.spec).toMatchObject({
      org: 'firestartr-test',
      billingEmail: 'billing@example.com',
      twitterUsername: 'firestartr',
      company: 'Prefapp',
      blog: 'https://www.prefapp.es',
      email: 'github-admins@example.com',
      location: 'Vigo, ES',
      description: 'Firestartr test GitHub organization',
      hasOrganizationProjects: true,
      hasRepositoryProjects: true,
      defaultRepositoryPermission: 'read',
      membersCanCreateRepositories: true,
      membersCanCreatePublicRepositories: false,
      membersCanCreatePrivateRepositories: true,
      membersCanCreateInternalRepositories: true,
      membersCanCreatePages: true,
      membersCanCreatePublicPages: false,
      membersCanCreatePrivatePages: true,
      membersCanForkPrivateRepositories: false,
      webCommitSignoffRequired: true,
      advancedSecurityEnabledForNewRepositories: true,
      dependabotAlertsEnabledForNewRepositories: true,
      dependabotSecurityUpdatesEnabledForNewRepositories: true,
      dependencyGraphEnabledForNewRepositories: true,
      secretScanningEnabledForNewRepositories: true,
      secretScanningPushProtectionEnabledForNewRepositories: true,
      context: {
        backend: {
          ref: {
            kind: 'FirestartrProviderConfig',
            name: 'aws-state-bucket',
          },
        },
        provider: {
          ref: {
            kind: 'FirestartrProviderConfig',
            name: 'github-app',
          },
        },
      },
      writeConnectionSecretToRef: {
        outputs: [],
      },
    });
    expect(cr.spec).not.toHaveProperty('name');
    expect(cr.spec.firestartr.tfStateKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(cr.spec.writeConnectionSecretToRef.name).toMatch(
      /^firestartrgithuborganizationsettings-firestartr-test-org-settings-[0-9a-f-]{36}-outputs$/,
    );
  });

  it('omits optional provider fields when absent', async () => {
    await context.applyPatches('orgsettings_a', [
      { op: 'remove', path: '/providers/github/twitter_username' },
      { op: 'remove', path: '/providers/github/company' },
      { op: 'remove', path: '/providers/github/blog' },
      { op: 'remove', path: '/providers/github/email' },
      { op: 'remove', path: '/providers/github/location' },
      { op: 'remove', path: '/providers/github/description' },
      { op: 'remove', path: '/providers/github/has_organization_projects' },
      { op: 'remove', path: '/providers/github/has_repository_projects' },
      { op: 'remove', path: '/providers/github/default_repository_permission' },
      { op: 'remove', path: '/providers/github/members_can_create_repositories' },
      {
        op: 'remove',
        path: '/providers/github/members_can_create_public_repositories',
      },
      {
        op: 'remove',
        path: '/providers/github/members_can_create_private_repositories',
      },
      {
        op: 'remove',
        path: '/providers/github/members_can_create_internal_repositories',
      },
      { op: 'remove', path: '/providers/github/members_can_create_pages' },
      {
        op: 'remove',
        path: '/providers/github/members_can_create_public_pages',
      },
      {
        op: 'remove',
        path: '/providers/github/members_can_create_private_pages',
      },
      {
        op: 'remove',
        path: '/providers/github/members_can_fork_private_repositories',
      },
      { op: 'remove', path: '/providers/github/web_commit_signoff_required' },
      {
        op: 'remove',
        path: '/providers/github/advanced_security_enabled_for_new_repositories',
      },
      {
        op: 'remove',
        path: '/providers/github/dependabot_alerts_enabled_for_new_repositories',
      },
      {
        op: 'remove',
        path: '/providers/github/dependabot_security_updates_enabled_for_new_repositories',
      },
      {
        op: 'remove',
        path: '/providers/github/dependency_graph_enabled_for_new_repositories',
      },
      {
        op: 'remove',
        path: '/providers/github/secret_scanning_enabled_for_new_repositories',
      },
      {
        op: 'remove',
        path: '/providers/github/secret_scanning_push_protection_enabled_for_new_repositories',
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const cr = findOrgSettingsCr(renderedMap);

    expect(cr).toBeDefined();
    expect(cr.spec).toMatchObject({
      org: 'firestartr-test',
      billingEmail: 'billing@example.com',
    });
    expect(cr.spec).not.toHaveProperty('company');
    expect(cr.spec).not.toHaveProperty('twitterUsername');
    expect(cr.spec).not.toHaveProperty('membersCanCreateRepositories');
    expect(cr.spec).not.toHaveProperty(
      'secretScanningPushProtectionEnabledForNewRepositories',
    );
  });

  it('does not render a GitHub organization settings CR without providers.github', async () => {
    await context.applyPatches('orgsettings_a', [
      { op: 'remove', path: '/providers/github' },
    ]);

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    expect(findOrgSettingsCr(renderedMap)).toBeUndefined();
  });

  it('rejects a duplicate organization settings CR from the full CR set', async () => {
    await context.applyPatches('orgsettings_a', [
      {
        op: 'replace',
        path: '/providers/github/org',
        value: 'firestartr-existing',
      },
    ]);

    await expect(
      context.renderClaims(
        { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
        { crsPath: await context.getBaseCrsDir() },
      ),
    ).rejects.toThrow(
      /Duplicate FirestartrGithubOrganizationSettings resources found for GitHub organization "firestartr-existing": existing-org-settings.*firestartr-test-org-settings/,
    );
  });

  it('renders multiple organization settings CRs for different GitHub organizations from one client', async () => {
    await context.duplicateFile('orgsettings_a', 'orgsettings_b');
    await context.applyPatches('orgsettings_b', [
      { op: 'replace', path: '/name', value: 'github_org_settings_b' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-org-settings-b',
      },
      {
        op: 'replace',
        path: '/providers/github/org',
        value: 'firestartr-test-b',
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      {
        claimRefs: [
          'OrgSettingsClaim-github_org_settings',
          'OrgSettingsClaim-github_org_settings_b',
        ],
      },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const orgSettingsCrs = findAllOrgSettingsCrs(renderedMap);

    expect(orgSettingsCrs).toHaveLength(2);
    expect(orgSettingsCrs.map((cr) => cr.spec.org).sort()).toEqual([
      'firestartr-test',
      'firestartr-test-b',
    ]);
  });

  it('rejects duplicate rendered organization settings CRs for the same GitHub organization', async () => {
    await context.duplicateFile('orgsettings_a', 'orgsettings_b');
    await context.applyPatches('orgsettings_b', [
      { op: 'replace', path: '/name', value: 'github_org_settings_b' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-org-settings-b',
      },
    ]);

    await expect(
      context.renderClaims(
        {
          claimRefs: [
            'OrgSettingsClaim-github_org_settings',
            'OrgSettingsClaim-github_org_settings_b',
          ],
        },
        { crsPath: rendererTestFixtures.noCrs },
      ),
    ).rejects.toThrow(
      /Duplicate FirestartrGithubOrganizationSettings resources found for GitHub organization "firestartr-test"/,
    );
  });
});
