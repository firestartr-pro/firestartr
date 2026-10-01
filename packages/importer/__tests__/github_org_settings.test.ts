import fs from 'node:fs/promises';
import path from 'path';
import common from 'catalog_common';
import OrgSettingsGithubDecanter from '../src/decanter/gh/github_org_settings';
import OrgSettingsCollectionGithubDecanter from '../src/decanter/gh/github_org_settings_collection';
import {setClaimsPath, setConfigPath} from '../src/decanter/config';
import {reimportGithubGitopsRepository} from '../src/reimporter';

const orgSettings = {
  billing_email: 'billing@example.com',
  company: 'PrefApp',
  has_organization_projects: false,
  has_repository_projects: true,
  members_can_create_repositories: false,
  dependency_graph_enabled_for_new_repositories: false,
};

function configureTestPaths() {
  setConfigPath(path.join(__dirname, 'fixtures', 'defaults'));
  setClaimsPath(path.join('/tmp/claims-dir'));
}

describe('GitHub organization settings importer decanter', () => {
  beforeEach(() => {
    configureTestPaths();
  });

  it('produces an OrgSettingsClaim with snake_case GitHub fields', async () => {
    const decanter = new OrgSettingsGithubDecanter({}, 'firestartr-test');
    decanter.github = {
      org: {
        getOrgInfo: jest.fn().mockResolvedValue(orgSettings),
      },
    };

    await decanter.gather();
    const result = await decanter.decant();

    expect(result.renderClaim.claim).toMatchObject({
      kind: 'OrgSettingsClaim',
      version: '1.0',
      name: 'firestartr-test-org-settings',
      providers: {
        github: {
          name: 'firestartr-test-org-settings',
          org: 'firestartr-test',
          billing_email: 'billing@example.com',
          company: 'PrefApp',
        },
      },
    });
  });

  it('preserves explicit false values and skips null optional fields', async () => {
    const decanter = new OrgSettingsGithubDecanter({}, 'firestartr-test');
    decanter.github = {
      org: {
        getOrgInfo: jest.fn().mockResolvedValue({
          ...orgSettings,
          blog: null,
        }),
      },
    };

    await decanter.gather();
    const result = await decanter.decant();

    expect(
      result.renderClaim.claim.providers.github.has_organization_projects,
    ).toBe(false);
    expect(
      result.renderClaim.claim.providers.github.members_can_create_repositories,
    ).toBe(false);
    expect(
      result.renderClaim.claim.providers.github
        .dependency_graph_enabled_for_new_repositories,
    ).toBe(false);
    expect(result.renderClaim.claim.providers.github.blog).toBeUndefined();
  });

  it('fails clearly when billing_email is missing', async () => {
    const decanter = new OrgSettingsGithubDecanter({}, 'firestartr-test');
    decanter.github = {
      org: {
        getOrgInfo: jest.fn().mockResolvedValue({}),
      },
    };

    await expect(decanter.gather()).rejects.toThrow(
      'billing_email is required for OrgSettingsClaim / FirestartrGithubOrganizationSettings',
    );
  });

  it('filters the singleton org settings collection', async () => {
    const collection = new OrgSettingsCollectionGithubDecanter(
      {},
      'firestartr-test',
    );

    await expect(
      collection.collection([
        {kind: 'gh-org-settings', type: 'NAME', name: 'other'},
      ]),
    ).resolves.toHaveLength(0);

    await expect(
      collection.collection([
        {kind: 'gh-org-settings', type: 'NAME', name: 'firestartr-test'},
      ]),
    ).resolves.toHaveLength(1);

    await expect(
      collection.collection([
        {kind: 'gh-org-settings', type: 'SKIP', name: 'SKIP'},
      ]),
    ).resolves.toHaveLength(0);
  });

  it('reimports org settings by org name', async () => {
    const crsPath = await fs.mkdtemp(
      path.join('/tmp', 'org-settings-reimport-'),
    );
    const filePath = path.join(crsPath, 'org-settings.yaml');

    await fs.writeFile(
      filePath,
      `kind: FirestartrGithubOrganizationSettings
metadata:
  name: firestartr-test-org-settings
  annotations:
    firestartr.dev/external-name: firestartr-test-org-settings
spec:
  org: firestartr-test
`,
    );

    try {
      await reimportGithubGitopsRepository('firestartr-test', crsPath, '', [
        {kind: 'gh-org-settings', type: 'NAME', name: 'firestartr-test'},
        {kind: 'gh-repo', type: 'SKIP', name: 'SKIP'},
      ]);

      const cr = common.io.fromYaml(await fs.readFile(filePath, 'utf-8'));

      expect(cr.metadata.annotations['firestartr.dev/needs-re-import']).toBe(
        'true',
      );
      expect(cr.metadata.annotations['firestartr.dev/import']).toBe('true');
    } finally {
      await fs.rm(crsPath, {recursive: true, force: true});
    }
  });
});
