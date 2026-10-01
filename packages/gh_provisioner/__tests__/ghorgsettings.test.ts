import { initSystemFS } from '../src';

import path from 'path';

import { EntityGHOrgSettings } from '../src/entities/ghorgsettings';

describe('EntityGHOrgSettings entity', () => {
  let entity: EntityGHOrgSettings;

  beforeEach(async () => {
    entity = (await initSystemFS(
      path.join(__dirname, 'fixtures/ghorgsettings/cr.yaml'),
      path.join(__dirname, 'fixtures/ghorgsettings/deps.yaml'),
    )) as EntityGHOrgSettings;
  });

  it('renders the Terraform config', async () => {
    expect(entity instanceof EntityGHOrgSettings).toBe(true);

    await entity.loadResources('apply');

    expect(entity.document).toStrictEqual({
      config: {
        billingEmail: 'billing@example.com',
        company: 'Prefapp',
        blog: 'https://example.com',
        email: 'hello@example.com',
        twitterUsername: 'prefapp',
        location: 'Vigo',
        name: 'Firestartr Test',
        description: 'Firestartr test organization',
        hasOrganizationProjects: true,
        hasRepositoryProjects: true,
        defaultRepositoryPermission: 'read',
        membersCanCreateRepositories: false,
        membersCanCreatePublicRepositories: false,
        membersCanCreatePrivateRepositories: true,
        membersCanCreateInternalRepositories: false,
        membersCanCreatePages: true,
        membersCanCreatePublicPages: false,
        membersCanCreatePrivatePages: true,
        membersCanForkPrivateRepositories: false,
        webCommitSignoffRequired: true,
        advancedSecurityEnabledForNewRepositories: false,
        dependabotAlertsEnabledForNewRepositories: true,
        dependabotSecurityUpdatesEnabledForNewRepositories: true,
        dependencyGraphEnabledForNewRepositories: true,
        secretScanningEnabledForNewRepositories: true,
        secretScanningPushProtectionEnabledForNewRepositories: true,
      },
    });
  });

  it('loads the organization settings import address', async () => {
    await entity.loadAddressesToImport();

    expect(entity.importDocument).toStrictEqual({
      imports: [
        {
          to: 'github_organization_settings.this',
          id: 'firestartr-test',
        },
      ],
    });
  });
});
