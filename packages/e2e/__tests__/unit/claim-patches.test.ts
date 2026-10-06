import {
  buildCommonClaimPatches,
  buildComponentClaimPatches,
  buildGroupClaimPatches,
} from '../../src/claim-patches';

describe('buildCommonClaimPatches', () => {
  it('keeps group GitHub org patches unchanged', () => {
    expect(
      buildCommonClaimPatches('demo-group', 'demo-org', 'GroupClaim'),
    ).toEqual([
      { op: 'replace', path: '/name', value: 'demo-group' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'demo-group',
      },
      { op: 'replace', path: '/providers/github/org', value: 'demo-org' },
    ]);
  });

  it('patches org webhook claims with providers.github.orgName', () => {
    expect(
      buildCommonClaimPatches('demo-hook', 'demo-org', 'OrgWebhookClaim'),
    ).toEqual([
      { op: 'replace', path: '/name', value: 'demo-hook' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'demo-hook',
      },
      { op: 'replace', path: '/providers/github/orgName', value: 'demo-org' },
    ]);
  });

  it('patches org settings claims with providers.github org and name', () => {
    expect(
      buildCommonClaimPatches('demo-settings', 'demo-org', 'OrgSettingsClaim'),
    ).toEqual([
      { op: 'replace', path: '/name', value: 'demo-settings' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'demo-settings',
      },
      { op: 'replace', path: '/providers/github/org', value: 'demo-org' },
    ]);
  });

  it('patches component claims to hard-delete repositories in e2e', () => {
    expect(
      buildCommonClaimPatches('demo-repo', 'demo-org', 'ComponentClaim'),
    ).toEqual([
      { op: 'replace', path: '/name', value: 'demo-repo' },
      {
        op: 'add',
        path: '/providers/github/archiveOnDestroy',
        value: false,
      },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'demo-repo',
      },
      { op: 'replace', path: '/providers/github/org', value: 'demo-org' },
    ]);
  });

  it('patches tfworkspace claims with providers.terraform.name only', () => {
    expect(
      buildCommonClaimPatches('demo-workspace', 'demo-org', 'TFWorkspaceClaim'),
    ).toEqual([
      { op: 'replace', path: '/name', value: 'demo-workspace' },
      {
        op: 'replace',
        path: '/providers/terraform/name',
        value: 'demo-workspace',
      },
    ]);
  });

  it('does not treat prototype properties as supported claim kinds', () => {
    expect(
      buildCommonClaimPatches('demo-hook', 'demo-org', 'constructor'),
    ).toEqual([{ op: 'replace', path: '/name', value: 'demo-hook' }]);
  });
});

describe('buildComponentClaimPatches', () => {
  it('empties the user-reference fields in the base component policy', () => {
    expect(
      buildComponentClaimPatches({ name: 'repo-a', ownerRef: 'group:g-a' }),
    ).toEqual([
      { op: 'replace', path: '/name', value: 'repo-a' },
      { op: 'replace', path: '/providers/github/name', value: 'repo-a' },
      { op: 'remove', path: '/system' },
      { op: 'replace', path: '/owner', value: 'group:g-a' },
      { op: 'replace', path: '/platformOwner', value: 'group:g-a' },
      { op: 'remove', path: '/maintainedBy' },
      { op: 'replace', path: '/providers/github/additionalRules', value: [] },
      {
        op: 'replace',
        path: '/providers/github/overrides/additionalAdmins',
        value: [],
      },
      {
        op: 'replace',
        path: '/providers/github/overrides/additionalMaintainers',
        value: [],
      },
      {
        op: 'replace',
        path: '/providers/github/overrides/additionalReaders',
        value: [],
      },
      {
        op: 'replace',
        path: '/providers/github/overrides/additionalWriters',
        value: [],
      },
      {
        op: 'replace',
        path: '/providers/github/overrides/additionalCodeownersRules',
        value: [],
      },
      {
        op: 'replace',
        path: '/providers/github/overrides/spec/actions/oidc/useDefault',
        value: true,
      },
      {
        op: 'replace',
        path: '/providers/github/overrides/spec/actions/oidc/includeClaimKeys',
        value: [],
      },
    ]);
  });

  it('appends suite-specific extras after the shared policy', () => {
    const patches = buildComponentClaimPatches({
      name: 'repo-a',
      ownerRef: 'group:g-a',
      hasIssues: false,
      extraPatches: [{ op: 'add', path: '/suite-specific', value: true }],
    });

    expect(patches).toEqual(
      expect.arrayContaining([
        {
          op: 'add',
          path: '/providers/github/overrides/spec/repo/hasIssues',
          value: false,
        },
      ]),
    );
    expect(patches.at(-1)).toEqual({
      op: 'add',
      path: '/suite-specific',
      value: true,
    });
  });

  it('adds the secrets section from the secret refs', () => {
    const patches = buildComponentClaimPatches({
      name: 'repo-a',
      ownerRef: 'group:g-a',
      secrets: [
        { name: 'E2E_ACTIONS_SECRET', value: 'ref:secretsclaim:ns:secret-a' },
      ],
    });

    expect(patches).toEqual(
      expect.arrayContaining([
        {
          op: 'add',
          path: '/providers/github/secrets',
          value: {
            actions: [
              {
                name: 'E2E_ACTIONS_SECRET',
                value: 'ref:secretsclaim:ns:secret-a',
              },
            ],
          },
        },
      ]),
    );
  });

  it('keeps an explicit codeowners rule list', () => {
    const rules = [{ path: 'custom/**', owners: ['group:g-a'] }];
    const patches = buildComponentClaimPatches({
      name: 'repo-a',
      ownerRef: 'group:g-a',
      additionalCodeownersRules: rules,
    });

    expect(patches).toEqual(
      expect.arrayContaining([
        {
          op: 'replace',
          path: '/providers/github/overrides/additionalCodeownersRules',
          value: rules,
        },
      ]),
    );
  });
});

describe('buildGroupClaimPatches', () => {
  it('emits the default-group name patches plus empty members', () => {
    expect(
      buildGroupClaimPatches({ name: 'demo-default-group', members: [] }),
    ).toEqual([
      { op: 'replace', path: '/name', value: 'demo-default-group' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'demo-default-group',
      },
      { op: 'replace', path: '/members', value: [] },
    ]);
  });

  it('points a nested group at its parent group ref', () => {
    expect(
      buildGroupClaimPatches({ members: [], parent: 'group:g-a' }),
    ).toEqual([
      { op: 'replace', path: '/members', value: [] },
      { op: 'replace', path: '/parent', value: 'group:g-a' },
    ]);
  });

  it('omits patches for omitted optional fields', () => {
    expect(buildGroupClaimPatches({})).toEqual([]);
  });
});
