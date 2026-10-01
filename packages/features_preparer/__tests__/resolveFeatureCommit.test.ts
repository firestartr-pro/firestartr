import { resolveFeatureCommit } from '../src/installer';

// Variables referenced inside the `jest.mock` factory must be prefixed with
// `mock` so Jest's hoisting does not complain about out-of-scope references.
const mockGetCommit = jest.fn();
const mockPaginate = jest.fn();
const mockRequest = jest.fn();
const mockGetOctokitForOrg = jest.fn();

// Mock the `github` package. We keep the real default export shape and only
// override `getOctokitForOrg` so that `gh.getOctokitForOrg(owner, true)` inside
// `resolveFeatureCommit` returns our controllable object.
jest.mock('github', () => {
  const originalModule = jest.requireActual('github');
  return {
    ...originalModule.default,
    getOctokitForOrg: (...args: any[]) => mockGetOctokitForOrg(...args),
  };
});

// Build a fresh Octokit-like object for each test so call assertions are clean.
function buildOctokit() {
  return {
    rest: {
      repos: {
        getCommit: mockGetCommit,
      },
    },
    paginate: mockPaginate,
    request: mockRequest,
  };
}

beforeEach(() => {
  mockGetCommit.mockReset();
  mockPaginate.mockReset();
  mockRequest.mockReset();
  mockGetOctokitForOrg.mockReset();
  mockGetOctokitForOrg.mockResolvedValue(buildOctokit());

  // Silence the warning logged by the graceful error path.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveFeatureCommit', () => {
  it('resolves the commit sha and matching lightweight tags', async () => {
    const sha = '1234567890abcdef1234567890abcdef12345678';

    mockGetCommit.mockResolvedValue({ data: { sha } });
    mockPaginate.mockResolvedValue([
      {
        ref: 'refs/tags/v1.0.0',
        object: { sha, type: 'commit' },
      },
      {
        ref: 'refs/tags/v0.9.0',
        object: { sha: 'othercommit', type: 'commit' },
      },
    ]);

    const result = await resolveFeatureCommit('prefapp', 'features', 'main');

    expect(result).toEqual({ sha, tags: ['v1.0.0'] });

    expect(mockGetCommit).toHaveBeenCalledTimes(1);
    expect(mockGetCommit).toHaveBeenCalledWith({
      owner: 'prefapp',
      repo: 'features',
      ref: 'main',
    });

    expect(mockPaginate).toHaveBeenCalledTimes(1);
    expect(mockPaginate).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/git/matching-refs/{ref}',
      { owner: 'prefapp', repo: 'features', ref: 'tags/', per_page: 100 },
    );
  });

  it('dereferences annotated tags before comparing SHAs', async () => {
    const commitSha = '1234567890abcdef1234567890abcdef12345678';
    const tagObjSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    mockGetCommit.mockResolvedValue({ data: { sha: commitSha } });
    mockPaginate.mockResolvedValue([
      {
        ref: 'refs/tags/v1.0.0',
        object: { sha: tagObjSha, type: 'tag' },
      },
      {
        ref: 'refs/tags/v0.9.0',
        object: { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', type: 'tag' },
      },
    ]);
    mockRequest.mockImplementation((route: string, params: any) => {
      if (route === 'GET /repos/{owner}/{repo}/git/tags/{tag_sha}') {
        if (params.tag_sha === tagObjSha) {
          return Promise.resolve({
            data: { object: { sha: commitSha, type: 'commit' } },
          });
        }
        return Promise.resolve({
          data: { object: { sha: 'othercommit', type: 'commit' } },
        });
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });

    const result = await resolveFeatureCommit('prefapp', 'features', 'main');

    expect(result).toEqual({ sha: commitSha, tags: ['v1.0.0'] });

    // The annotated tag should have been dereferenced.
    expect(mockRequest).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/git/tags/{tag_sha}',
      { owner: 'prefapp', repo: 'features', tag_sha: tagObjSha },
    );
  });

  it('dereferences each tag object once, even when refs share it', async () => {
    const commitSha = '1234567890abcdef1234567890abcdef12345678';
    const sharedTagObjSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    mockGetCommit.mockResolvedValue({ data: { sha: commitSha } });
    mockPaginate.mockResolvedValue([
      {
        ref: 'refs/tags/v1.0.0',
        object: { sha: sharedTagObjSha, type: 'tag' },
      },
      {
        ref: 'refs/tags/v1.0.1',
        object: { sha: sharedTagObjSha, type: 'tag' },
      },
    ]);
    mockRequest.mockResolvedValue({
      data: { object: { sha: commitSha, type: 'commit' } },
    });

    const result = await resolveFeatureCommit('prefapp', 'features', 'main');

    expect(result.tags).toEqual(['v1.0.0', 'v1.0.1']);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('continues collecting tags when an annotated tag dereference fails', async () => {
    const commitSha = '1234567890abcdef1234567890abcdef12345678';
    const failingTagObjSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const workingTagObjSha = 'cccccccccccccccccccccccccccccccccccccccc';

    mockGetCommit.mockResolvedValue({ data: { sha: commitSha } });
    mockPaginate.mockResolvedValue([
      {
        ref: 'refs/tags/v1.0.0',
        object: { sha: failingTagObjSha, type: 'tag' },
      },
      {
        ref: 'refs/tags/v2.0.0',
        object: { sha: workingTagObjSha, type: 'tag' },
      },
      {
        ref: 'refs/tags/v3.0.0-lightweight',
        object: { sha: commitSha, type: 'commit' },
      },
    ]);
    mockRequest.mockImplementation((route: string, params: any) => {
      if (route === 'GET /repos/{owner}/{repo}/git/tags/{tag_sha}') {
        if (params.tag_sha === failingTagObjSha) {
          return Promise.reject(new Error('tag object not found'));
        }
        if (params.tag_sha === workingTagObjSha) {
          return Promise.resolve({
            data: { object: { sha: commitSha, type: 'commit' } },
          });
        }
      }
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });

    const result = await resolveFeatureCommit('prefapp', 'features', 'main');

    // The failing annotated tag is skipped; the working annotated tag
    // and the lightweight tag are both collected. Lightweight tags are
    // resolved first (no extra requests), annotated tags follow.
    expect(result).toEqual({ sha: commitSha, tags: ['v3.0.0-lightweight', 'v2.0.0'] });
  });

  it('returns empty sha and tags when getCommit fails', async () => {
    mockGetCommit.mockRejectedValue(new Error('API failure'));

    const result = await resolveFeatureCommit('prefapp', 'features', 'bad-ref');

    expect(result).toEqual({ sha: '', tags: [] });
  });

  it('returns empty sha and tags when getOctokitForOrg throws', async () => {
    mockGetOctokitForOrg.mockRejectedValue(new Error('no token available'));

    const result = await resolveFeatureCommit('prefapp', 'features', 'main');

    expect(result).toEqual({ sha: '', tags: [] });
  });

  it('returns resolved SHA with empty tags when tag listing fails', async () => {
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    mockGetCommit.mockResolvedValue({ data: { sha } });
    mockPaginate.mockRejectedValue(new Error('rate limit exceeded'));

    const result = await resolveFeatureCommit('prefapp', 'features', 'main');

    expect(result).toEqual({ sha, tags: [] });
  });

  it('collects all matching tags from the full result set', async () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';

    mockGetCommit.mockResolvedValue({ data: { sha } });

    const manyRefs = Array.from({ length: 120 }, (_unused, i) => ({
      ref: `refs/tags/t${i}`,
      object: {
        sha: i === 5 || i === 110 ? sha : 'different',
        type: 'commit',
      },
    }));

    mockPaginate.mockResolvedValue(manyRefs);

    const result = await resolveFeatureCommit('prefapp', 'features', 'main');

    expect(result.sha).toEqual(sha);
    expect(result.tags).toEqual(['t5', 't110']);

    expect(mockPaginate).toHaveBeenCalledTimes(1);
    expect(mockPaginate).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/git/matching-refs/{ref}',
      { owner: 'prefapp', repo: 'features', ref: 'tags/', per_page: 100 },
    );
  });
});
