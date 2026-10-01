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
});
