import {
  validateGithubOrgVariableSectionSingleton,
  validateActionsVariablesUniqueness,
} from '../src/validations/githubOrgVariableSection';
import { validateSubReferences } from '../src/validations/crossReferences';

function variableSectionCr(
  name: string,
  org: string,
  claimRef?: string,
  actionsVariables?: any[],
) {
  return {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrGithubOrganizationVariableSection',
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
      actionsVariables: actionsVariables || [],
    },
  };
}

function validateRenderedVarSecSingleton(crs: Record<string, unknown>): void {
  validateGithubOrgVariableSectionSingleton(crs as any);
}

function validateRenderedVarUniqueness(crs: Record<string, unknown>): void {
  validateActionsVariablesUniqueness(crs as any);
}

describe('validateGithubOrgVariableSectionSingleton', () => {
  it('allows one VariableSection CR per GitHub organization', () => {
    expect(() =>
      validateRenderedVarSecSingleton({
        'FirestartrGithubOrganizationVariableSection-org-a':
          variableSectionCr('org-a', 'org-a'),
        'FirestartrGithubOrganizationVariableSection-org-b':
          variableSectionCr('org-b', 'org-b'),
      }),
    ).not.toThrow();
  });

  it('rejects duplicate VariableSection CRs for the same GitHub organization', () => {
    expect(() =>
      validateRenderedVarSecSingleton({
        'FirestartrGithubOrganizationVariableSection-varsec-a':
          variableSectionCr(
            'varsec-a',
            'firestartr-test',
            'OrgSettingsClaim/github_org_settings_a',
          ),
        'FirestartrGithubOrganizationVariableSection-varsec-b':
          variableSectionCr(
            'varsec-b',
            'firestartr-test',
            'OrgSettingsClaim/github_org_settings_b',
          ),
      }),
    ).toThrow(
      /Duplicate FirestartrGithubOrganizationVariableSection resources found for GitHub organization "firestartr-test"/,
    );
  });

  it('rejects duplicate VariableSection CRs for orgs with different casing', () => {
    expect(() =>
      validateRenderedVarSecSingleton({
        'FirestartrGithubOrganizationVariableSection-varsec-a':
          variableSectionCr(
            'varsec-a',
            'Firestartr-Test',
            'OrgSettingsClaim/github_org_settings_a',
          ),
        'FirestartrGithubOrganizationVariableSection-varsec-b':
          variableSectionCr(
            'varsec-b',
            'firestartr-test',
            'OrgSettingsClaim/github_org_settings_b',
          ),
      }),
    ).toThrow(
      /Duplicate FirestartrGithubOrganizationVariableSection resources found for GitHub organization "firestartr-test"/,
    );
  });

  it('ignores VariableSection CRs without spec org', () => {
    expect(() =>
      validateRenderedVarSecSingleton({
        'FirestartrGithubOrganizationVariableSection-varsec-a': {
          kind: 'FirestartrGithubOrganizationVariableSection',
          metadata: { name: 'varsec-a' },
          spec: {},
        },
        'FirestartrGithubOrganizationVariableSection-varsec-b': {
          kind: 'FirestartrGithubOrganizationVariableSection',
          metadata: { name: 'varsec-b' },
          spec: {},
        },
      }),
    ).not.toThrow();
  });

  it('ignores VariableSection CRs with non-string spec org', () => {
    expect(() =>
      validateRenderedVarSecSingleton({
        'FirestartrGithubOrganizationVariableSection-varsec-a': {
          kind: 'FirestartrGithubOrganizationVariableSection',
          metadata: { name: 'varsec-a' },
          spec: { org: 123 },
        },
        'FirestartrGithubOrganizationVariableSection-varsec-b': {
          kind: 'FirestartrGithubOrganizationVariableSection',
          metadata: { name: 'varsec-b' },
          spec: { org: {} },
        },
      }),
    ).not.toThrow();
  });
});

describe('validateActionsVariablesUniqueness', () => {
  it('allows unique variable names', () => {
    expect(() =>
      validateRenderedVarUniqueness({
        'FirestartrGithubOrganizationVariableSection-org-a':
          variableSectionCr('org-a', 'org-a', undefined, [
            { name: 'VAR_A', value: 'a', visibility: 'all' },
            { name: 'VAR_B', value: 'b', visibility: 'private' },
          ]),
      }),
    ).not.toThrow();
  });

  it('rejects duplicate variable names within a VariableSection CR', () => {
    expect(() =>
      validateRenderedVarUniqueness({
        'FirestartrGithubOrganizationVariableSection-org-a':
          variableSectionCr('org-a', 'org-a', undefined, [
            { name: 'MY_VAR', value: 'a', visibility: 'all' },
            { name: 'MY_VAR', value: 'b', visibility: 'private' },
          ]),
      }),
    ).toThrow(
      /Duplicate action variable name "MY_VAR" found in FirestartrGithubOrganizationVariableSection for organization "org-a"/,
    );
  });

  it('ignores VariableSection CRs without actionsVariables', () => {
    expect(() =>
      validateRenderedVarUniqueness({
        'FirestartrGithubOrganizationVariableSection-org-a':
          variableSectionCr('org-a', 'org-a'),
      }),
    ).not.toThrow();
  });

  it('ignores non-VariableSection CRs', () => {
    expect(() =>
      validateRenderedVarUniqueness({
        'FirestartrGithubOrganizationSettings-org-a': {
          kind: 'FirestartrGithubOrganizationSettings',
          metadata: { name: 'org-a' },
          spec: { org: 'org-a' },
        },
      }),
    ).not.toThrow();
  });
});

describe('validateActionsVariablesSelectedRepositories', () => {
  function orgSettingsClaim(
    name: string,
    actionsVariables?: any[],
  ) {
    return {
      claim: {
        kind: 'OrgSettingsClaim',
        name,
        providers: {
          github: {
            name,
            org: name,
            billing_email: 'billing@example.com',
            actions_variables: actionsVariables,
          },
        },
      },
    };
  }

  function componentClaim(name: string) {
    return {
      claim: {
        kind: 'ComponentClaim',
        name,
        providers: {
          github: {
            name,
            org: 'test-org',
          },
        },
      },
    };
  }

  function validateSelectedRepos(claims: Record<string, any>): void {
    validateSubReferences(claims as any);
  }

  it('allows valid component refs when components exist', () => {
    expect(() =>
      validateSelectedRepos({
        'OrgSettingsClaim-test-org': orgSettingsClaim('test-org', [
          {
            name: 'MY_VAR',
            value: 'secret',
            visibility: 'selected',
            selected_repositories: ['component:comp-a'],
          },
        ]),
        'ComponentClaim-comp-a': componentClaim('comp-a'),
      }),
    ).not.toThrow();
  });

  it('rejects component refs when the component does not exist', () => {
    expect(() =>
      validateSelectedRepos({
        'OrgSettingsClaim-test-org': orgSettingsClaim('test-org', [
          {
            name: 'MY_VAR',
            value: 'secret',
            visibility: 'selected',
            selected_repositories: ['component:nonexistent'],
          },
        ]),
      }),
    ).toThrow(
      /CrossReference error: OrgSettingsClaim\/test-org references a non-existent component "nonexistent" in actions_variables\.MY_VAR\.selected_repositories/,
    );
  });

  it('ignores variables with visibility other than selected', () => {
    expect(() =>
      validateSelectedRepos({
        'OrgSettingsClaim-test-org': orgSettingsClaim('test-org', [
          {
            name: 'ALL_VAR',
            value: 'val',
            visibility: 'all',
            selected_repositories: ['component:nonexistent'],
          },
          {
            name: 'PRIVATE_VAR',
            value: 'val',
            visibility: 'private',
            selected_repositories: ['component:nonexistent'],
          },
        ]),
      }),
    ).not.toThrow();
  });

  it('ignores empty selected_repositories', () => {
    expect(() =>
      validateSelectedRepos({
        'OrgSettingsClaim-test-org': orgSettingsClaim('test-org', [
          {
            name: 'SEL_VAR',
            value: 'val',
            visibility: 'selected',
            selected_repositories: [],
          },
        ]),
      }),
    ).not.toThrow();
  });

  it('ignores non-OrgSettingsClaim entries', () => {
    expect(() =>
      validateSelectedRepos({
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

  it('ignores claims without actions_variables', () => {
    expect(() =>
      validateSelectedRepos({
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
