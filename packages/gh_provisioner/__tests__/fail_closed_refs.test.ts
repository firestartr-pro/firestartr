jest.mock('github');

import { EntityGHRepo } from '../src/entities/ghrepo';

import { provisionPermissions } from '../src/entities/ghrepo/helpers/teams';
import { provisionVariables } from '../src/entities/ghrepo/helpers/variables';

function repoCr(permissions: any[], vars?: any) {
  return {
    kind: 'FirestartrGithubRepository',
    apiVersion: 'firestartr.dev/v1',
    metadata: { name: 'repo-a', annotations: {} },
    spec: {
      org: 'test-org',
      repo: { defaultBranch: 'main' },
      actions: { oidc: { useDefault: true, includeClaimKeys: [] } },
      context: {
        backend: { ref: { kind: 'FirestartrProviderConfig', name: 'kubernetes-provider' } },
        provider: { ref: { kind: 'FirestartrProviderConfig', name: 'github' } },
      },
      permissions,
      ...(vars ? { vars } : {}),
    },
  };
}

function groupDep(id: string) {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubGroup',
      metadata: { name: id, annotations: {} },
      spec: {},
    },
    secret: {
      apiVersion: 'v1',
      kind: 'Secret',
      data: {
        outputs: Buffer.from(JSON.stringify({ id })).toString('base64'),
      },
    },
  };
}

function providerDep(name: string) {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrProviderConfig',
      metadata: { name, annotations: {} },
      spec: { secrets: {} },
    },
    secret: { apiVersion: 'v1', kind: 'Secret', data: {} },
  };
}

function contextDeps() {
  return {
    'FirestartrProviderConfig-kubernetes-provider': providerDep('kubernetes-provider'),
    'FirestartrProviderConfig-github': providerDep('github'),
  };
}

describe('unresolved refs fail closed', () => {
  it('throws instead of skipping an unresolved team ref', () => {
    const gh = new EntityGHRepo(
      repoCr([
        { ref: { kind: 'FirestartrGithubGroup', name: 'missing-team' }, role: 'pull' },
      ]),
      contextDeps(),
    );

    expect(() => provisionPermissions(gh)).toThrow(
      /could not resolve team ref missing-team/,
    );
    expect(gh.document.config.teams).toEqual([]);
  });

  it('throws instead of skipping an unresolved membership ref', () => {
    const gh = new EntityGHRepo(
      repoCr([
        { ref: { kind: 'FirestartrGithubMembership', name: 'missing-user' }, role: 'pull' },
      ]),
      contextDeps(),
    );

    expect(() => provisionPermissions(gh)).toThrow(
      /could not resolve membership ref missing-user/,
    );
    expect(gh.document.config.collaborators).toEqual([]);
  });

  it('throws instead of skipping an unresolved variable secret ref', async () => {
    const gh = new EntityGHRepo(
      repoCr([], { actions: [{ name: 'FOO', ref: { name: 'missing-secret', key: 'foo' } }] }),
      contextDeps(),
    );

    await expect(provisionVariables(gh)).rejects.toThrow(
      /could not resolve secret ref missing-secret/,
    );
    expect(gh.document.config.variables).toEqual([]);
  });

  it('fails the whole load when a required ref is missing from the run deps', async () => {
    const gh = new EntityGHRepo(
      repoCr([
        { ref: { kind: 'FirestartrGithubGroup', name: 'missing-team' }, role: 'pull' },
      ]),
      contextDeps(),
    );

    await expect(gh.loadResources('apply')).rejects.toEqual(
      expect.stringContaining('could not resolve team ref missing-team'),
    );
  });

  it('provisions the same CR from its own deps while a disjoint run fails', () => {
    const cr = repoCr([
      { ref: { kind: 'FirestartrGithubGroup', name: 'team-a' }, role: 'pull' },
    ]);

    const withTeam = new EntityGHRepo(cr, { ...contextDeps(), 'FirestartrGithubGroup-team-a': groupDep('team-a-id') });
    const withoutTeam = new EntityGHRepo(cr, contextDeps());

    provisionPermissions(withTeam);

    expect(withTeam.document.config.teams).toEqual([
      { teamId: 'team-a-id', permission: 'pull' },
    ]);

    expect(() => provisionPermissions(withoutTeam)).toThrow(
      /could not resolve team ref team-a/,
    );
    expect(withoutTeam.document.config.teams).toEqual([]);
  });

  it('provisions a variable whose secret is in the run deps', async () => {
    const gh = new EntityGHRepo(
      repoCr([], { actions: [{ name: 'FOO', ref: { name: 'team-a-secret', key: 'foo' } }] }),
      {
        ...contextDeps(),
        'Secret-team-a-secret': {
          cr: null,
          secret: {
            apiVersion: 'v1',
            kind: 'Secret',
            data: { foo: Buffer.from('bar').toString('base64') },
          },
        },
      },
    );

    await provisionVariables(gh);

    expect(gh.document.config.variables).toEqual([
      { variableName: 'FOO', value: 'bar' },
    ]);
  });
});
