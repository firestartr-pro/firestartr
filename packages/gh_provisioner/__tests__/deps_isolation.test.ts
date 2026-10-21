import { initSystem } from '../src';

// A minimal CR per run: each run binds its own dependency map.
function groupCr(name: string) {
  return {
    kind: 'FirestartrGithubGroup',
    apiVersion: 'firestartr.dev/v1',
    metadata: { name, annotations: {} },
    spec: {
      description: 'a group',
      privacy: 'closed',
      members: [],
    },
  };
}

function teamDep(name: string) {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubGroup',
      metadata: { name, annotations: {} },
      spec: {},
    },
    secret: {
      apiVersion: 'v1',
      kind: 'Secret',
      data: {
        outputs: Buffer.from(JSON.stringify({ id: `${name}-id` })).toString(
          'base64',
        ),
      },
    },
  };
}

function selfOutputsDep(name: string, outputs: Record<string, any>) {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubGroup',
      metadata: { name, annotations: {} },
      spec: {},
    },
    secret: {
      apiVersion: 'v1',
      kind: 'Secret',
      data: {
        outputs: Buffer.from(JSON.stringify(outputs)).toString('base64'),
      },
    },
  };
}

const depsA = {
  'self-outputs': selfOutputsDep('group-a', { id: 'group-a-id' }),
  'FirestartrGithubGroup-team-a': teamDep('team-a'),
};

const depsB = {
  'FirestartrGithubGroup-team-b': teamDep('team-b'),
};

describe('per-run dependency isolation', () => {
  it('gives each concurrent run only its own teams', async () => {
    const [a, b] = await Promise.all([
      initSystem(groupCr('group-a'), depsA),
      initSystem(groupCr('group-b'), depsB),
    ]);

    expect(
      a.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-a' }),
    ).toBeTruthy();
    expect(
      a.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-b' }),
    ).toBeNull();

    expect(
      b.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-b' }),
    ).toBeTruthy();
    expect(
      b.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-a' }),
    ).toBeNull();
  });

  it('keeps the first run isolated after a second run binds another map', async () => {
    const a = await initSystem(groupCr('group-a'), depsA);
    const b = await initSystem(groupCr('group-b'), depsB);

    expect(
      a.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-a' }),
    ).toBeTruthy();
    expect(
      a.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-b' }),
    ).toBeNull();
    expect(
      b.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-b' }),
    ).toBeTruthy();
    expect(
      b.resolveRef({ kind: 'FirestartrGithubGroup', name: 'team-a' }),
    ).toBeNull();
  });

  it('resolves self outputs through the same map', async () => {
    const a = await initSystem(groupCr('group-a'), depsA);
    const b = await initSystem(groupCr('group-b'), depsB);

    expect(a.cr.id).toBe('group-a-id');
    expect(b.cr.id).toBeUndefined();
  });
});
