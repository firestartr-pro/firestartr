jest.mock('github');

import { EntityGHRepo } from '../src/entities/ghrepo';

import { EntityGroup } from '../src/entities/group';

import { EntityGHFeature } from '../src/entities/ghfeature';

import { EntityGHOrgWebHook } from '../src/entities/ghorgwebhook';

import { EntityGHRepositorySecretsSection } from '../src/entities/ghrepositorysecretssection';

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

function groupDepWithoutIdOutput() {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubGroup',
      metadata: { name: 'team-a', annotations: {} },
      spec: {},
    },
    secret: {
      apiVersion: 'v1',
      kind: 'Secret',
      data: {
        other: Buffer.from('value').toString('base64'),
      },
    },
  };
}

function providerDep(name: string, secrets: any = {}) {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrProviderConfig',
      metadata: { name, annotations: {} },
      spec: { secrets },
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

function secretDep(data: Record<string, string>) {
  return {
    cr: null,
    secret: { apiVersion: 'v1', kind: 'Secret', data },
  };
}

function repoDep(name: string) {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubRepository',
      metadata: { name, annotations: {} },
      spec: { org: 'test-org' },
    },
    secret: { apiVersion: 'v1', kind: 'Secret', data: {} },
  };
}

function groupCr(members: any[] = [], parentTeam?: any) {
  return {
    kind: 'FirestartrGithubGroup',
    apiVersion: 'firestartr.dev/v1',
    metadata: { name: 'group-a', annotations: {} },
    spec: {
      description: 'a group',
      privacy: 'closed',
      members,
      ...(parentTeam ? { parentTeam: { ref: parentTeam } } : {}),
    },
  };
}

function featureCr() {
  return {
    kind: 'FirestartrGithubRepositoryFeature',
    apiVersion: 'firestartr.dev/v1',
    metadata: { name: 'feature-a', annotations: {} },
    spec: {
      repositoryTarget: {
        ref: { kind: 'FirestartrGithubRepository', name: 'missing-repo' },
        branch: 'main',
      },
      files: [],
    },
  };
}

function webhookCr() {
  return {
    kind: 'FirestartrGithubOrgWebhook',
    apiVersion: 'firestartr.dev/v1',
    metadata: { name: 'hook-a', annotations: {} },
    spec: {
      orgName: 'test-org',
      webhook: {
        url: 'https://example.com/hook',
        events: ['push'],
        contentType: 'json',
        secretRef: { name: 'missing-secret', key: 'url' },
      },
    },
  };
}

function grssCr(actions?: any[]) {
  return {
    kind: 'FirestartrGithubRepositorySecretsSection',
    apiVersion: 'firestartr.dev/v1',
    metadata: { name: 'section-a', annotations: {} },
    spec: {
      repositoryTarget: {
        ref: { kind: 'FirestartrGithubRepository', name: 'repo-a' },
      },
      ...(actions ? { secrets: { actions } } : {}),
    },
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
      /could not resolve FirestartrGithubGroup\/missing-team ref from its dependencies/,
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
      /could not resolve FirestartrGithubMembership\/missing-user ref from its dependencies/,
    );
    expect(gh.document.config.collaborators).toEqual([]);
  });

  it('throws instead of skipping an unresolved variable secret ref', async () => {
    const gh = new EntityGHRepo(
      repoCr([], { actions: [{ name: 'FOO', ref: { name: 'missing-secret', key: 'foo' } }] }),
      contextDeps(),
    );

    await expect(provisionVariables(gh)).rejects.toThrow(
      /could not resolve Secret\/missing-secret ref from its dependencies/,
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
      expect.stringContaining(
        'could not resolve FirestartrGithubGroup/missing-team ref',
      ),
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
      /could not resolve FirestartrGithubGroup\/team-a ref/,
    );
    expect(withoutTeam.document.config.teams).toEqual([]);
  });

  it('provisions a variable whose secret is in the run deps', async () => {
    const gh = new EntityGHRepo(
      repoCr([], { actions: [{ name: 'FOO', ref: { name: 'team-a-secret', key: 'foo' } }] }),
      {
        ...contextDeps(),
        'Secret-team-a-secret': secretDep({
          foo: Buffer.from('bar').toString('base64'),
        }),
      },
    );

    await provisionVariables(gh);

    expect(gh.document.config.variables).toEqual([
      { variableName: 'FOO', value: 'bar' },
    ]);
  });
});

describe('absent refs and outputs produce clear errors instead of TypeErrors', () => {
  it('names the missing context ref in the backend and provider getters', () => {
    const gh = new EntityGHRepo(repoCr([], {}), {});

    expect(() => gh.backend).toThrow(
      /could not resolve FirestartrProviderConfig\/kubernetes-provider ref from its dependencies/,
    );
    expect(() => gh.provider).toThrow(
      /could not resolve FirestartrProviderConfig\/github ref from its dependencies/,
    );
  });

  it('names the missing provider secret output in the github credentials', () => {
    const gh = new EntityGHRepo(repoCr([]), {
      'FirestartrProviderConfig-kubernetes-provider': providerDep('kubernetes-provider'),
      'FirestartrProviderConfig-github': providerDep('github', {
        GITHUB_TOKEN: { secretRef: { name: 'missing-token-secret', key: 'token' } },
      }),
    });

    expect(() => gh.githubGithubProviderCredentials).toThrow(
      /could not resolve Secret\/missing-token-secret ref from its dependencies/,
    );
  });

  it('names the missing team id output instead of provisioning undefined', () => {
    const gh = new EntityGHRepo(
      repoCr([
        { ref: { kind: 'FirestartrGithubGroup', name: 'team-a' }, role: 'pull' },
      ]),
      { ...contextDeps(), 'FirestartrGithubGroup-team-a': groupDepWithoutIdOutput() },
    );

    expect(() => provisionPermissions(gh)).toThrow(
      /could not resolve output 'id' of FirestartrGithubGroup\/team-a/,
    );
    expect(gh.document.config.teams).toEqual([]);
  });

  it('names the missing variable secret key instead of provisioning undefined', async () => {
    const gh = new EntityGHRepo(
      repoCr([], { actions: [{ name: 'FOO', ref: { name: 'the-secret', key: 'missing' } }] }),
      {
        ...contextDeps(),
        'Secret-the-secret': secretDep({
          other: Buffer.from('value').toString('base64'),
        }),
      },
    );

    await expect(provisionVariables(gh)).rejects.toThrow(
      /could not resolve output 'missing' of Secret\/the-secret/,
    );
    expect(gh.document.config.variables).toEqual([]);
  });

  it('fails closed when a declared parentTeam ref is absent', async () => {
    const group = new EntityGroup(
      groupCr([], { kind: 'FirestartrGithubGroup', name: 'missing-parent' }),
      {},
    );

    await expect(group.loadResources()).rejects.toEqual(
      expect.stringContaining(
        'could not resolve FirestartrGithubGroup/missing-parent ref',
      ),
    );
  });

  it('names the missing membership ref of a group instead of a TypeError', async () => {
    const group = new EntityGroup(
      groupCr([
        { ref: { kind: 'FirestartrGithubMembership', name: 'missing-user' } },
      ]),
      {},
    );

    await expect(group.loadResources()).rejects.toEqual(
      expect.stringContaining(
        'could not resolve FirestartrGithubMembership/missing-user ref',
      ),
    );
  });

  it('names the missing repository target of a feature instead of a TypeError', async () => {
    const feature = new EntityGHFeature(featureCr(), {});

    await expect(feature.loadResources('apply')).rejects.toThrow(
      /could not resolve FirestartrGithubRepository\/missing-repo ref/,
    );
  });

  it('names the missing webhook secret instead of a TypeError', async () => {
    const hook = new EntityGHOrgWebHook(webhookCr(), {});

    await expect(hook.loadResources('apply')).rejects.toEqual(
      expect.stringContaining('could not resolve Secret/missing-secret ref'),
    );
  });

  it('names the missing repository of a secrets section instead of a TypeError', async () => {
    const section = new EntityGHRepositorySecretsSection(grssCr(), {});

    await expect(section.loadResources('apply')).rejects.toEqual(
      expect.stringContaining(
        'could not resolve FirestartrGithubRepository/repo-a ref',
      ),
    );
  });

  it('names the missing plain secret of a secrets section instead of a TypeError', async () => {
    const section = new EntityGHRepositorySecretsSection(
      grssCr([{ name: 'FOO', ref: { key: 'rds_conn', kind: 'Secret', name: 'missing-secret' } }]),
      { 'FirestartrGithubRepository-repo-a': repoDep('repo-a') },
    );

    await expect(section.loadResources('apply')).rejects.toEqual(
      expect.stringContaining('could not resolve Secret/missing-secret ref'),
    );
  });

  it('names the missing secret key of a secrets section instead of provisioning undefined', async () => {
    const section = new EntityGHRepositorySecretsSection(
      grssCr([{ name: 'FOO', ref: { key: 'rds_conn', kind: 'Secret', name: 'secret-a' } }]),
      {
        'FirestartrGithubRepository-repo-a': repoDep('repo-a'),
        'Secret-secret-a': secretDep({
          other: Buffer.from('value').toString('base64'),
        }),
      },
    );

    await expect(section.loadResources('apply')).rejects.toEqual(
      expect.stringContaining(
        "could not resolve output 'rds_conn' of Secret/secret-a",
      ),
    );
  });
});
