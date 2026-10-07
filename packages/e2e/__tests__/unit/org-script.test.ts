import { orgScript, type OrgScriptFixture } from '../..';

const DEFAULT_COMPONENT_GROUP_REF = 'group:default-e2e-owner';

function findClaimByName(
  claims: Array<Record<string, unknown>>,
  name: string,
): Record<string, unknown> {
  const claim = claims.find((item) => item.name === name);
  if (!claim) {
    throw new Error(`Expected claim ${name} to exist`);
  }

  return claim;
}

function findFixtureByClaimName(
  fixtures: OrgScriptFixture[],
  claimName: string,
): OrgScriptFixture {
  const fixture = fixtures.find((item) => item.claimName === claimName);
  if (!fixture) {
    throw new Error(`Expected fixture for claim ${claimName} to exist`);
  }

  return fixture;
}

describe('orgScript', () => {
  it('builds github orgScript output with prefixed monikers', () => {
    const script = orgScript('demo');

    expect(script.monikers).toEqual({
      'group-a': 'demo-e2e-group-a',
      'group-b': 'demo-e2e-Group B',
      'group-c': 'demo-e2e-Research &&& Development',
      'repo-a': 'demo-e2e-frontend',
      'repo-b': 'demo-e2e-backend',
    });

    expect(script.claims.groups).toHaveLength(3);
    expect(script.claims.components).toHaveLength(2);
  });

  it('includes all renderable fixture entries when nothing is excluded', () => {
    const script = orgScript('demo');

    const fixtureEntries = script.fixtures.map(
      ({ fixtureName, claimName }) => `${fixtureName}:${claimName ?? ''}`,
    );
    expect(fixtureEntries).toEqual([
      'group-a:demo-e2e-group-a',
      'group-b:demo-e2e-group-b',
      'group-c:demo-e2e-group-c',
      'component-a:demo-e2e-frontend',
      'component-a:demo-e2e-backend',
    ]);

    // group-a: only the members patch.
    const groupA = findFixtureByClaimName(script.fixtures, 'demo-e2e-group-a');
    expect(groupA?.patches).toEqual([
      { op: 'replace', path: '/members', value: [] },
    ]);

    // group-b: members patch + parent patch pointing to the prefixed group-a claim name.
    const groupB = findFixtureByClaimName(script.fixtures, 'demo-e2e-group-b');
    expect(groupB?.patches).toEqual([
      { op: 'replace', path: '/members', value: [] },
      { op: 'add', path: '/parent', value: 'group:demo-e2e-group-a' },
    ]);

    // group-c: members patch + parent patch pointing to the prefixed group-b claim name.
    const groupC = findFixtureByClaimName(script.fixtures, 'demo-e2e-group-c');
    expect(groupC?.patches).toEqual([
      { op: 'replace', path: '/members', value: [] },
      { op: 'add', path: '/parent', value: 'group:demo-e2e-group-b' },
    ]);

    const frontend = findFixtureByClaimName(
      script.fixtures,
      'demo-e2e-frontend',
    );
    expect(frontend?.patches).toEqual(
      expect.arrayContaining([
        { op: 'replace', path: '/name', value: 'demo-e2e-frontend' },
        {
          op: 'replace',
          path: '/providers/github/name',
          value: 'demo-e2e-frontend',
        },
        {
          op: 'add',
          path: '/providers/github/vars',
          value: {
            actions: [{ name: 'VAR_A', value: 'VALUE_A' }],
          },
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
        { op: 'remove', path: '/system' },
        { op: 'replace', path: '/owner', value: 'group:demo-e2e-group-a' },
        {
          op: 'replace',
          path: '/platformOwner',
          value: 'group:demo-e2e-group-b',
        },
      ]),
    );

    const backend = findFixtureByClaimName(script.fixtures, 'demo-e2e-backend');
    expect(backend?.patches).toEqual(
      expect.arrayContaining([
        { op: 'replace', path: '/name', value: 'demo-e2e-backend' },
        {
          op: 'replace',
          path: '/providers/github/name',
          value: 'demo-e2e-backend',
        },
        {
          op: 'add',
          path: '/providers/github/topics',
          value: ['topic-a', 'topic-b'],
        },
      ]),
    );
  });

  it('excludes fixture entries for omitted categories', () => {
    const script = orgScript('demo', {
      exclude: { groups: true, domains: true },
      defaultGroupRef: DEFAULT_COMPONENT_GROUP_REF,
    });

    const names = script.fixtures.map((f) => f.claimName);
    expect(names).toEqual(['demo-e2e-frontend', 'demo-e2e-backend']);

    const frontend = findFixtureByClaimName(
      script.fixtures,
      'demo-e2e-frontend',
    );
    expect(frontend?.patches).toEqual(
      expect.arrayContaining([
        {
          op: 'replace',
          path: '/owner',
          value: DEFAULT_COMPONENT_GROUP_REF,
        },
        {
          op: 'replace',
          path: '/platformOwner',
          value: DEFAULT_COMPONENT_GROUP_REF,
        },
        { op: 'remove', path: '/system' },
      ]),
    );
  });

  it('builds the same fixture set when unsupported categories are excluded', () => {
    const script = orgScript('demo', {
      exclude: { systems: true, domains: true },
    });

    const names = script.fixtures.map((f) => f.claimName);
    expect(names).toEqual([
      'demo-e2e-group-a',
      'demo-e2e-group-b',
      'demo-e2e-group-c',
      'demo-e2e-frontend',
      'demo-e2e-backend',
    ]);

    const frontend = findFixtureByClaimName(
      script.fixtures,
      'demo-e2e-frontend',
    );
    expect(frontend?.patches).toEqual(
      expect.arrayContaining([
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
        { op: 'remove', path: '/system' },
        { op: 'replace', path: '/owner', value: 'group:demo-e2e-group-a' },
        {
          op: 'replace',
          path: '/platformOwner',
          value: 'group:demo-e2e-group-b',
        },
      ]),
    );

    const backend = findFixtureByClaimName(script.fixtures, 'demo-e2e-backend');
    expect(backend?.patches).toEqual(
      expect.arrayContaining([{ op: 'remove', path: '/system' }]),
    );
  });

  it('maps frontend vars/features/permissions into component claim fields', () => {
    const script = orgScript('draft');
    const frontend = findClaimByName(
      script.claims.components,
      'draft-e2e-frontend',
    );
    const backend = findClaimByName(
      script.claims.components,
      'draft-e2e-backend',
    );

    expect(frontend.owner).toBe('group:' + script.monikers['group-a']);
    expect(frontend.platformOwner).toBe('group:' + script.monikers['group-b']);
    expect(frontend.maintainedBy).toEqual([
      'group:' + script.monikers['group-c'],
    ]);
    expect(backend.owner).toBe('group:' + script.monikers['group-a']);
    expect(backend.platformOwner).toBe('group:' + script.monikers['group-b']);
    expect(backend.maintainedBy).toEqual([
      'group:' + script.monikers['group-c'],
    ]);

    const providers = frontend.providers as Record<string, unknown>;
    const github = providers.github as Record<string, unknown>;

    expect(github.features).toEqual([
      { name: 'build_and_dispatch_docker_images', ref: 'main' },
    ]);
    expect(github.vars).toEqual({
      actions: [{ name: 'VAR_A', value: 'VALUE_A' }],
    });
  });

  it('supports exclude components via repos alias from issue text', () => {
    const script = orgScript('demo', {
      exclude: {
        repos: true,
      },
    });

    expect(script.claims.components).toHaveLength(0);
    expect(script.monikers['repo-a']).toBeUndefined();
    expect(script.monikers['repo-b']).toBeUndefined();
  });

  it('keeps components valid when groups are excluded', () => {
    const script = orgScript('demo', {
      exclude: {
        groups: true,
      },
      defaultGroupRef: DEFAULT_COMPONENT_GROUP_REF,
    });

    expect(script.claims.groups).toHaveLength(0);

    const frontend = findClaimByName(
      script.claims.components,
      'demo-e2e-frontend',
    );
    const backend = findClaimByName(
      script.claims.components,
      'demo-e2e-backend',
    );
    expect(frontend.owner).toBe(DEFAULT_COMPONENT_GROUP_REF);
    expect(frontend.platformOwner).toBe(DEFAULT_COMPONENT_GROUP_REF);
    expect(frontend.maintainedBy).toBeUndefined();
    expect(backend.owner).toBe(DEFAULT_COMPONENT_GROUP_REF);
    expect(backend.platformOwner).toBe(DEFAULT_COMPONENT_GROUP_REF);
    expect(backend.maintainedBy).toBeUndefined();
  });

  it('requires defaultGroupRef when groups are excluded for components', () => {
    expect(() =>
      orgScript('demo', {
        exclude: {
          groups: true,
        },
      }),
    ).toThrow('defaultGroupRef');
  });

  it('supports exclude components via canonical components key', () => {
    const script = orgScript('demo', {
      exclude: {
        components: true,
      },
    });

    expect(script.claims.components).toHaveLength(0);
    expect(script.monikers['repo-a']).toBeUndefined();
    expect(script.monikers['repo-b']).toBeUndefined();
  });

  it('keeps supported output stable when unsupported categories are excluded', () => {
    const script = orgScript('demo', {
      exclude: {
        systems: true,
        domains: true,
      },
    });

    expect(script.monikers).toEqual({
      'group-a': 'demo-e2e-group-a',
      'group-b': 'demo-e2e-Group B',
      'group-c': 'demo-e2e-Research &&& Development',
      'repo-a': 'demo-e2e-frontend',
      'repo-b': 'demo-e2e-backend',
    });
    expect(script.claims.groups).toHaveLength(3);
    expect(script.claims.components).toHaveLength(2);
  });

  it('applies custom org to GitHub provider claims', () => {
    const script = orgScript('demo', {
      org: 'custom-org',
    });

    const group = findClaimByName(script.claims.groups, 'demo-e2e-group-a');
    const component = findClaimByName(
      script.claims.components,
      'demo-e2e-frontend',
    );

    const groupProviders = group.providers as Record<string, unknown>;
    const groupGithub = groupProviders.github as Record<string, unknown>;
    const componentProviders = component.providers as Record<string, unknown>;
    const componentGithub = componentProviders.github as Record<
      string,
      unknown
    >;

    expect(groupGithub.org).toBe('custom-org');
    expect(componentGithub.org).toBe('custom-org');
  });

  it('handles empty and whitespace prefixes consistently', () => {
    const scriptEmpty = orgScript('');
    const scriptSpaces = orgScript('   ');

    expect(scriptEmpty.monikers).toEqual(scriptSpaces.monikers);
    expect(scriptEmpty.monikers).toEqual({
      'group-a': 'e2e-group-a',
      'group-b': 'e2e-Group B',
      'group-c': 'e2e-Research &&& Development',
      'repo-a': 'e2e-frontend',
      'repo-b': 'e2e-backend',
    });
  });
});
