import { validateGithubOrgSettingsSingleton } from '../src/validations/githubOrgSettings';

function orgSettingsCr(name: string, org: string, claimRef?: string) {
  return {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrGithubOrganizationSettings',
    metadata: {
      name,
      annotations: claimRef
        ? {
            'firestartr.dev/claim-ref': claimRef,
          }
        : undefined,
    },
    spec: {
      org,
    },
  };
}

function validateRendered(crs: Record<string, unknown>): void {
  validateGithubOrgSettingsSingleton(crs as any);
}

describe('validateGithubOrgSettingsSingleton', () => {
  it('allows one organization settings CR per GitHub organization', () => {
    expect(() =>
      validateRendered({
        'FirestartrGithubOrganizationSettings-org-a': orgSettingsCr(
          'org-a',
          'org-a',
        ),
        'FirestartrGithubOrganizationSettings-org-b': orgSettingsCr(
          'org-b',
          'org-b',
        ),
      }),
    ).not.toThrow();
  });

  it('rejects duplicate organization settings CRs for the same GitHub organization', () => {
    expect(() =>
      validateRendered({
        'FirestartrGithubOrganizationSettings-org-settings-a': orgSettingsCr(
          'org-settings-a',
          'firestartr-test',
          'OrgSettingsClaim/github_org_settings_a',
        ),
        'FirestartrGithubOrganizationSettings-org-settings-b': orgSettingsCr(
          'org-settings-b',
          'firestartr-test',
          'OrgSettingsClaim/github_org_settings_b',
        ),
      }),
    ).toThrow(
      /Duplicate FirestartrGithubOrganizationSettings resources found for GitHub organization "firestartr-test": org-settings-a \(claim: OrgSettingsClaim\/github_org_settings_a\), org-settings-b \(claim: OrgSettingsClaim\/github_org_settings_b\)/,
    );
  });

  it('rejects duplicate organization settings CRs for GitHub organizations with different casing', () => {
    expect(() =>
      validateRendered({
        'FirestartrGithubOrganizationSettings-org-settings-a': orgSettingsCr(
          'org-settings-a',
          'Firestartr-Test',
          'OrgSettingsClaim/github_org_settings_a',
        ),
        'FirestartrGithubOrganizationSettings-org-settings-b': orgSettingsCr(
          'org-settings-b',
          'firestartr-test',
          'OrgSettingsClaim/github_org_settings_b',
        ),
      }),
    ).toThrow(
      /Duplicate FirestartrGithubOrganizationSettings resources found for GitHub organization "firestartr-test"/,
    );
  });

  it('ignores organization settings CRs without spec org', () => {
    expect(() =>
      validateRendered({
        'FirestartrGithubOrganizationSettings-org-settings-a': {
          kind: 'FirestartrGithubOrganizationSettings',
          metadata: {
            name: 'org-settings-a',
          },
          spec: {},
        },
        'FirestartrGithubOrganizationSettings-org-settings-b': {
          kind: 'FirestartrGithubOrganizationSettings',
          metadata: {
            name: 'org-settings-b',
          },
          spec: {},
        },
      }),
    ).not.toThrow();
  });

  it('ignores organization settings CRs with non-string spec org', () => {
    expect(() =>
      validateRendered({
        'FirestartrGithubOrganizationSettings-org-settings-a': {
          kind: 'FirestartrGithubOrganizationSettings',
          metadata: {
            name: 'org-settings-a',
          },
          spec: {
            org: 123,
          },
        },
        'FirestartrGithubOrganizationSettings-org-settings-b': {
          kind: 'FirestartrGithubOrganizationSettings',
          metadata: {
            name: 'org-settings-b',
          },
          spec: {
            org: {},
          },
        },
      }),
    ).not.toThrow();
  });
});
