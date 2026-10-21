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

  it('loads the outputs secret when a later reference requires it after a needsSecret:false one', async () => {
    const dependency = {
      kind: 'FirestartrGithubRepository',
      metadata: { name: 'repo-a', namespace: 'test-namespace' },
      spec: {},
    };
    const secret = { metadata: { name: 'repo-a-outputs' }, data: {} };

    const getItemByItemPath = jest.fn(async () => dependency);
    const getSecret = jest.fn(async () => secret);

    const result = await resolve(
      {
        kind: 'FirestartrGithubRepositoryFeature',
        metadata: { name: 'feature-a', namespace: 'test-namespace' },
        spec: {
          repositoryTarget: {
            ref: {
              kind: 'FirestartrGithubRepository',
              name: 'repo-a',
              needsSecret: false,
            },
          },
          // Same dep, but this reference consumes its outputs.
          branch: {
            ref: { kind: 'FirestartrGithubRepository', name: 'repo-a' },
          },
        },
      },
      getItemByItemPath,
      getSecret,
    );

    // The CR is fetched once, but the outputs are loaded for the reference
    // that needs them instead of being skipped by the cached entry.
    expect(getItemByItemPath).toHaveBeenCalledTimes(1);
    expect(getSecret).toHaveBeenCalledWith(
      'test-namespace',
      'firestartrgithubrepository-repo-a-outputs',
    );
    expect(result['FirestartrGithubRepository-repo-a'].secret).toBe(secret);
  });

  it('fails closed when a later reference needs outputs that were never published', async () => {
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
          kind: 'FirestartrGithubRepositoryFeature',
          metadata: { name: 'feature-a', namespace: 'test-namespace' },
          spec: {
            repositoryTarget: {
              ref: {
                kind: 'FirestartrGithubRepository',
                name: 'repo-a',
                needsSecret: false,
              },
            },
            branch: {
              ref: { kind: 'FirestartrGithubRepository', name: 'repo-a' },
            },
          },
        },
        getItemByItemPath,
        getSecret,
      ),
    ).rejects.toThrow(
      /'FirestartrGithubRepositoryFeature\/feature-a' in namespace 'test-namespace' depends on 'FirestartrGithubRepository\/repo-a', but its outputs secret 'firestartrgithubrepository-repo-a-outputs' was not found/,
    );
  });

  it('resolves the same dep once when two references both need its outputs', async () => {
    const dependency = {
      kind: 'FirestartrGithubRepository',
      metadata: { name: 'repo-a', namespace: 'test-namespace' },
      spec: {},
    };
    const secret = { metadata: { name: 'repo-a-outputs' }, data: {} };

    const getItemByItemPath = jest.fn(async () => dependency);
    const getSecret = jest.fn(async () => secret);

    const result = await resolve(
      {
        kind: 'FirestartrGithubRepositoryFeature',
        metadata: { name: 'feature-a', namespace: 'test-namespace' },
        spec: {
          repositoryTarget: {
            ref: { kind: 'FirestartrGithubRepository', name: 'repo-a' },
          },
          branch: {
            ref: { kind: 'FirestartrGithubRepository', name: 'repo-a' },
          },
        },
      },
      getItemByItemPath,
      getSecret,
    );

    expect(getItemByItemPath).toHaveBeenCalledTimes(1);
    expect(getSecret).toHaveBeenCalledTimes(1);
    expect(result['FirestartrGithubRepository-repo-a'].secret).toBe(secret);
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

  it('wraps a rejecting dependency lookup in a contextual ResolverError', async () => {
    // Production lookups (ctl.getItemByItemPath) reject on 404 instead of
    // returning undefined: the contextual error must cover that path too.
    const lookupError = new Error(
      "Error on getItemByItemPath: test-namespace/githubrepositories/repo-a: Not Found",
    );

    const getItemByItemPath = jest.fn(async () => {
      throw lookupError;
    });

    const getSecret = jest.fn(async () => undefined);

    let caught: any;

    try {
      await resolve(
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
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ResolverError);
    expect(caught.refKey).toBe('FirestartrGithubRepository-repo-a');
    expect(caught.message).toMatch(
      /'FirestartrGithubGroup\/group-a' in namespace 'test-namespace' depends on 'FirestartrGithubRepository\/repo-a'.*aborting instead of provisioning with an incomplete dependency map/,
    );
    expect(caught.message).toContain('Not Found');
    expect(caught.cause).toBe(lookupError);
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
