import {
  validateGithubOrgSecretSectionSingleton,
  validateSecretNamesUniqueness,
  validateOrgSecretsCrossReferences,
} from '../src/validations/githubOrgSecretSection';

function secretSectionCr(
  name: string,
  org: string,
  claimRef?: string,
  secrets?: any,
) {
  return {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrGithubOrganizationSecretSection',
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
      secrets: secrets || { actions: [], codespaces: [], dependabot: [] },
    },
  };
}

function validateRenderedSecretSecSingleton(
  crs: Record<string, unknown>,
): void {
  validateGithubOrgSecretSectionSingleton(crs as any);
}

function validateRenderedSecretUniqueness(crs: Record<string, unknown>): void {
  validateSecretNamesUniqueness(crs as any);
}

describe('validateGithubOrgSecretSectionSingleton', () => {
  it('allows one SecretSection CR per GitHub organization', () => {
    expect(() =>
      validateRenderedSecretSecSingleton({
        'FirestartrGithubOrganizationSecretSection-org-a': secretSectionCr(
          'org-a',
          'org-a',
        ),
        'FirestartrGithubOrganizationSecretSection-org-b': secretSectionCr(
          'org-b',
          'org-b',
        ),
      }),
    ).not.toThrow();
  });

  it('rejects duplicate SecretSection CRs for the same GitHub organization', () => {
    expect(() =>
      validateRenderedSecretSecSingleton({
        'FirestartrGithubOrganizationSecretSection-sec-a': secretSectionCr(
          'sec-a',
          'firestartr-test',
          'OrgSettingsClaim/github_org_settings_a',
        ),
        'FirestartrGithubOrganizationSecretSection-sec-b': secretSectionCr(
          'sec-b',
          'firestartr-test',
          'OrgSettingsClaim/github_org_settings_b',
        ),
      }),
    ).toThrow(
      /Duplicate FirestartrGithubOrganizationSecretSection resources found for GitHub organization "firestartr-test"/,
    );
  });

  it('rejects duplicate SecretSection CRs for orgs with different casing', () => {
    expect(() =>
      validateRenderedSecretSecSingleton({
        'FirestartrGithubOrganizationSecretSection-sec-a': secretSectionCr(
          'sec-a',
          'Firestartr-Test',
          'OrgSettingsClaim/github_org_settings_a',
        ),
        'FirestartrGithubOrganizationSecretSection-sec-b': secretSectionCr(
          'sec-b',
          'firestartr-test',
          'OrgSettingsClaim/github_org_settings_b',
        ),
      }),
    ).toThrow(
      /Duplicate FirestartrGithubOrganizationSecretSection resources found for GitHub organization "firestartr-test"/,
    );
  });

  it('ignores SecretSection CRs without spec org', () => {
    expect(() =>
      validateRenderedSecretSecSingleton({
        'FirestartrGithubOrganizationSecretSection-sec-a': {
          kind: 'FirestartrGithubOrganizationSecretSection',
          metadata: { name: 'sec-a' },
          spec: {},
        },
        'FirestartrGithubOrganizationSecretSection-sec-b': {
          kind: 'FirestartrGithubOrganizationSecretSection',
          metadata: { name: 'sec-b' },
          spec: {},
        },
      }),
    ).not.toThrow();
  });

  it('ignores SecretSection CRs with non-string spec org', () => {
    expect(() =>
      validateRenderedSecretSecSingleton({
        'FirestartrGithubOrganizationSecretSection-sec-a': {
          kind: 'FirestartrGithubOrganizationSecretSection',
          metadata: { name: 'sec-a' },
          spec: { org: 123 },
        },
        'FirestartrGithubOrganizationSecretSection-sec-b': {
          kind: 'FirestartrGithubOrganizationSecretSection',
          metadata: { name: 'sec-b' },
          spec: { org: {} },
        },
      }),
    ).not.toThrow();
  });
});

describe('validateSecretNamesUniqueness', () => {
  it('allows unique secret names within sections', () => {
    expect(() =>
      validateRenderedSecretUniqueness({
        'FirestartrGithubOrganizationSecretSection-org-a': secretSectionCr(
          'org-a',
          'org-a',
          undefined,
          {
            actions: [
              {
                name: 'SECRET_A',
                ref: { kind: 'Secret', name: 'a', key: 'a' },
              },
              {
                name: 'SECRET_B',
                ref: { kind: 'Secret', name: 'b', key: 'b' },
              },
            ],
            codespaces: [],
            dependabot: [],
          },
        ),
      }),
    ).not.toThrow();
  });

  it('rejects duplicate secret names within actions section', () => {
    expect(() =>
      validateRenderedSecretUniqueness({
        'FirestartrGithubOrganizationSecretSection-org-a': secretSectionCr(
          'org-a',
          'org-a',
          undefined,
          {
            actions: [
              {
                name: 'MY_SECRET',
                ref: { kind: 'Secret', name: 'a', key: 'a' },
              },
              {
                name: 'MY_SECRET',
                ref: { kind: 'Secret', name: 'b', key: 'b' },
              },
            ],
            codespaces: [],
            dependabot: [],
          },
        ),
      }),
    ).toThrow(
      /Duplicate secret name "MY_SECRET" found in actions section of FirestartrGithubOrganizationSecretSection for organization "org-a"/,
    );
  });

  it('allows same secret name in different sections', () => {
    expect(() =>
      validateRenderedSecretUniqueness({
        'FirestartrGithubOrganizationSecretSection-org-a': secretSectionCr(
          'org-a',
          'org-a',
          undefined,
          {
            actions: [
              {
                name: 'MY_SECRET',
                ref: { kind: 'Secret', name: 'a', key: 'a' },
              },
            ],
            codespaces: [
              {
                name: 'MY_SECRET',
                ref: { kind: 'Secret', name: 'b', key: 'b' },
              },
            ],
            dependabot: [],
          },
        ),
      }),
    ).not.toThrow();
  });

  it('ignores SecretSection CRs without secrets', () => {
    expect(() =>
      validateRenderedSecretUniqueness({
        'FirestartrGithubOrganizationSecretSection-org-a': secretSectionCr(
          'org-a',
          'org-a',
        ),
      }),
    ).not.toThrow();
  });

  it('ignores non-SecretSection CRs', () => {
    expect(() =>
      validateRenderedSecretUniqueness({
        'FirestartrGithubOrganizationSettings-org-a': {
          kind: 'FirestartrGithubOrganizationSettings',
          metadata: { name: 'org-a' },
          spec: { org: 'org-a' },
        },
      }),
    ).not.toThrow();
  });
});

describe('validateOrgSecretsCrossReferences', () => {
  function orgSettingsClaim(name: string, orgSecrets?: any) {
    return {
      claim: {
        kind: 'OrgSettingsClaim',
        name,
        providers: {
          github: {
            name,
            org: name,
            billing_email: 'billing@example.com',
            org_secrets: orgSecrets,
          },
        },
      },
    };
  }

  function secretsClaim(name: string, secrets: any[]) {
    return {
      claim: {
        kind: 'SecretsClaim',
        name,
        providers: {
          external_secrets: {
            name: 'test-store',
            secretStore: { kind: 'SecretStore', name: 'test-store' },
            externalSecrets: {
              refreshInterval: '90d',
              secrets,
            },
          },
        },
      },
    };
  }

  function validateCrossRefs(claims: Record<string, any>): void {
    validateOrgSecretsCrossReferences(claims as any);
  }

  it('allows valid secret refs when SecretsClaim exists', () => {
    expect(() =>
      validateCrossRefs({
        'OrgSettingsClaim-test-org': orgSettingsClaim('test-org', {
          actions: [
            {
              name: 'MY_SECRET',
              value: 'ref:secretsclaim:my-secret:MY_KEY',
            },
          ],
        }),
        'SecretsClaim-my-secret': secretsClaim('my-secret', [
          { secretName: 'MY_KEY', remoteRef: 'my_key' },
        ]),
      }),
    ).not.toThrow();
  });

  it('skips refs to non-existent SecretsClaim (not loaded)', () => {
    expect(() =>
      validateCrossRefs({
        'OrgSettingsClaim-test-org': orgSettingsClaim('test-org', {
          actions: [
            {
              name: 'MY_SECRET',
              value: 'ref:secretsclaim:nonexistent:KEY',
            },
          ],
        }),
      }),
    ).not.toThrow();
  });

  it('rejects refs to non-existent secret key', () => {
    expect(() =>
      validateCrossRefs({
        'OrgSettingsClaim-test-org': orgSettingsClaim('test-org', {
          actions: [
            {
              name: 'MY_SECRET',
              value: 'ref:secretsclaim:my-secret:NONEXISTENT_KEY',
            },
          ],
        }),
        'SecretsClaim-my-secret': secretsClaim('my-secret', [
          { secretName: 'EXISTING_KEY', remoteRef: 'existing' },
        ]),
      }),
    ).toThrow(
      /CrossReference error: OrgSettingsClaim\/test-org references a non-existent secret key "NONEXISTENT_KEY"/,
    );
  });

  it('ignores non-OrgSettingsClaim entries', () => {
    expect(() =>
      validateCrossRefs({
        'DomainClaim-test-domain': {
          claim: {
            kind: 'DomainClaim',
            name: 'test-domain',
            providers: {},
          },
        },
      }),
    ).not.toThrow();
  });

  it('ignores claims without org_secrets', () => {
    expect(() =>
      validateCrossRefs({
        'OrgSettingsClaim-test-org': {
          claim: {
            kind: 'OrgSettingsClaim',
            name: 'test-org',
            providers: {
              github: {
                name: 'test-org',
                org: 'test-org',
                billing_email: 'billing@example.com',
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });
});
