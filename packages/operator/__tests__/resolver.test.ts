import { ResolverError, resolve } from '../src/resolver';
import { getItemByItemPathMockFn, getSecretMockFn } from './fixtures/utils';

describe('Resolver', () => {
  it('Resolves dependencies', async () => {
    const result = await resolve(
      {
        kind: 'FirestartrGithubRepository',
        metadata: {
          name: 'test-name',
          namespace: 'test-namespace',
        },
        spec: {
          owner: {
            ref: {
              kind: 'FirestartrGithubRepository',
              name: 'test-name-1',
            },
          },
          maintainers: [
            {
              ref: {
                kind: 'FirestartrGithubRepository',
                name: 'test-name-1',
              },
            },
            {
              ref: {
                kind: 'FirestartrGithubRepository',
                name: 'test-name-2',
              },
            },
            {
              ref: {
                kind: 'FirestartrGithubRepository',
                name: 'test-name-3',
              },
            },
          ],
          needle1: {
            needle2: {
              needle3: {
                needleArray: [
                  {
                    ref: {
                      kind: 'FirestartrGithubRepository',
                      name: 'test-name-4',
                    },
                  },
                ],
              },
            },
          },
        },
      },
      getItemByItemPathMockFn,
      getSecretMockFn,
    );

    console.log('result: ', JSON.stringify(result, null, 4));

    expect(Object.keys(result).length).toEqual(4);

    expect(
      result['FirestartrGithubRepository-test-name-1'].cr.metadata.name,
    ).toEqual('test-name-1');

    expect(
      result['FirestartrGithubRepository-test-name-2'].cr.metadata.name,
    ).toEqual('test-name-2');

    expect(
      result['FirestartrGithubRepository-test-name-3'].cr.metadata.name,
    ).toEqual('test-name-3');

    expect(
      result['FirestartrGithubRepository-test-name-4'].cr.metadata.name,
    ).toEqual('test-name-4');
  });

  it('skips secret lookup when a ref sets needsSecret false', async () => {
    const dependency = {
      kind: 'FirestartrGithubRepository',
      metadata: {
        name: 'repo-a',
        namespace: 'test-namespace',
      },
      spec: {},
    };
    const getItemByItemPath = jest.fn(async () => dependency);
    const getSecret = jest.fn();

    const result = await resolve(
      {
        kind: 'FirestartrGithubRepositoryFeature',
        metadata: {
          name: 'feature-a',
          namespace: 'test-namespace',
        },
        spec: {
          repositoryTarget: {
            ref: {
              kind: 'FirestartrGithubRepository',
              name: 'repo-a',
              needsSecret: false,
            },
          },
        },
      },
      getItemByItemPath,
      getSecret,
    );

    expect(getItemByItemPath).toHaveBeenCalledWith(
      'test-namespace/githubrepositories/repo-a',
      'firestartr.dev',
      'v1',
    );
    expect(getSecret).not.toHaveBeenCalled();
    expect(result['FirestartrGithubRepository-repo-a']).toEqual({
      cr: dependency,
      secret: undefined,
    });
  });

  it('Throws an exception if the ref was not found', async () => {
    await expect(
      async () =>
        await resolve(
          {
            kind: 'FirestartrGithubRepository',
            metadata: {
              name: 'test-name',
              namespace: 'test-namespace',
            },
            spec: {
              owner: {
                ref: {
                  kind: 'FirestartrGithubRepository',
                  name: 'test-name-NO-EXIST',
                },
              },
            },
          },
          getItemByItemPathMockFn,
          getSecretMockFn,
        ),
    ).rejects.toThrow(ResolverError);
  });

  it('names the referring CR and namespace when a dependency is missing', async () => {
    await expect(
      resolve(
        {
          kind: 'FirestartrGithubGroup',
          metadata: { name: 'group-a', namespace: 'test-namespace' },
          spec: {
            members: [
              {
                ref: { kind: 'FirestartrGithubMembership', name: 'missing-user' },
              },
            ],
          },
        },
        getItemByItemPathMockFn,
        getSecretMockFn,
      ),
    ).rejects.toThrow(
      /'FirestartrGithubGroup\/group-a' in namespace 'test-namespace' depends on 'FirestartrGithubMembership\/missing-user'.*does not exist/,
    );
  });

  it('throws when the outputs secret of a dependency is missing', async () => {
    const dependency = {
      kind: 'FirestartrGithubRepository',
      metadata: { name: 'repo-a', namespace: 'test-namespace' },
      spec: {},
    };

    const getItemByItemPath = jest.fn(async () => dependency);
    const getSecret = jest.fn(async () => undefined);

    await expect(
      resolve(
        {
          kind: 'FirestartrGithubGroup',
          metadata: { name: 'group-a', namespace: 'test-namespace' },
          spec: {
            members: [
              { ref: { kind: 'FirestartrGithubRepository', name: 'repo-a' } },
            ],
          },
        },
        getItemByItemPath,
        getSecret,
      ),
    ).rejects.toThrow(
      /'FirestartrGithubGroup\/group-a' in namespace 'test-namespace' depends on 'FirestartrGithubRepository\/repo-a', but its outputs secret 'firestartrgithubrepository-repo-a-outputs' was not found/,
    );

    expect(getSecret).toHaveBeenCalledWith(
      'test-namespace',
      'firestartrgithubrepository-repo-a-outputs',
    );
  });

  it('does not require an outputs secret for a ProviderConfig dependency', async () => {
    const providerConfig = {
      kind: 'FirestartrProviderConfig',
      metadata: { name: 'kubernetes-backend', namespace: 'test-namespace' },
      spec: {},
    };

    const getItemByItemPath = jest.fn(async () => providerConfig);
    const getSecret = jest.fn(async () => undefined);

    const deps = await resolve(
      {
        kind: 'FirestartrGithubGroup',
        metadata: { name: 'group-a', namespace: 'test-namespace' },
        spec: {
          context: {
            backend: {
              ref: {
                kind: 'FirestartrProviderConfig',
                name: 'kubernetes-backend',
              },
            },
          },
        },
      },
      getItemByItemPath,
      getSecret,
    );

    expect(deps['FirestartrProviderConfig-kubernetes-backend']).toEqual({
      cr: providerConfig,
      secret: undefined,
    });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('keeps a Kubernetes Secret dependency without requiring an outputs secret', async () => {
    const k8sSecret = {
      kind: 'Secret',
      metadata: { name: 'user-secret', namespace: 'test-namespace' },
      data: { token: Buffer.from('value').toString('base64') },
    };

    const getItemByItemPath = jest.fn(async () => k8sSecret);
    const getSecret = jest.fn(async () => undefined);

    const deps = await resolve(
      {
        kind: 'FirestartrGithubGroup',
        metadata: { name: 'group-a', namespace: 'test-namespace' },
        spec: {
          somethingElse: { secretRef: { name: 'user-secret' } },
        },
      },
      getItemByItemPath,
      getSecret,
    );

    expect(deps['Secret-user-secret']).toEqual({
      cr: k8sSecret,
      secret: undefined,
    });
    expect(getSecret).not.toHaveBeenCalled();
  });
});
