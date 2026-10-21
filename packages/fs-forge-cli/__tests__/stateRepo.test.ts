import { formatPrState, findCrOnMainBranch } from '../src/claims/stateRepo';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { RepoRef } from '../src/github/api';

function createApi(
  fileContents: Record<string, string | null>,
  defaultBranch = 'main',
  pullState = 'merged',
  pullNumbers: number[] = [100],
): MemoryGitHubApi {
  const ref: RepoRef = { owner: 'test-org', repo: 'state-github' };
  const api = new MemoryGitHubApi();
  api.setDefaultBranch(ref, defaultBranch);
  for (const [key, content] of Object.entries(fileContents)) {
    if (content === null) continue;
    const path = key.split('@')[0];
    api.setFile(ref, path, content);
  }
  api.setPullRequests(
    ref,
    pullNumbers.map((number) => ({
      number,
      htmlUrl: `https://github.com/test/repo/pull/${number}`,
      state: pullState,
      headRef: `automated-${number}`,
      baseSha: 'base123',
      updatedAt: '2024-01-01T00:00:00Z',
    })),
  );
  return api;
}

describe('stateRepo', () => {
  describe('formatPrState', () => {
    it.each<[string | null, string]>([
      ['merged', 'merged'],
      ['open', 'open'],
      ['closed', 'closed (not merged)'],
      [null, 'unknown'],
    ])('formats %s state', (state, expected) => {
      expect(formatPrState(state)).toBe(expected);
    });
  });

  describe('findCrOnMainBranch', () => {
    it('finds CRs by claim-ref annotation on the default-branch tree', async () => {
      const api = createApi({
        'cr1.yaml@main':
          'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app\n    firestartr.dev/last-state-pr: state-github#100',
      });

      const results = await findCrOnMainBranch(
        api,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(1);
      expect(results[0].kind).toBe('FirestartrGithubRepository');
      expect(results[0].lastStatePr?.number).toBe(100);
      expect(api.calls).toContain(
        'downloadTarball test-org/state-github@main',
      );
    });

    it('finds a committed CR before it is indexed by code search', async () => {
      const api = createApi({
        'new-cr.yaml@main': [
          'kind: FirestartrGithubRepository',
          'metadata:',
          '  name: new-repo',
          '  annotations:',
          '    firestartr.dev/claim-ref: ComponentClaim/my-app',
          '    firestartr.dev/last-state-pr: state-github#100',
        ].join('\n'),
      });

      const results = await findCrOnMainBranch(api, 'test-org/state-github', 'ComponentClaim', 'my-app');

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('new-cr.yaml');
      expect(results[0].lastStatePr?.number).toBe(100);
    });

    it('keeps only exact claim-ref annotations from the tree', async () => {
      const api = createApi(
        {
          'matching.yaml@main': 'metadata:\n  annotations:\n    firestartr.dev/claim-ref: "ComponentClaim/my-app"',
          'other.yml@main': 'metadata:\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app-other',
          'invalid.yaml@main': 'metadata: [',
        },
        'trunk',
      );

      const results = await findCrOnMainBranch(api, 'test-org/state-github', 'ComponentClaim', 'my-app');

      expect(results.map((cr) => cr.path)).toEqual(['matching.yaml']);
      expect(api.calls).toContain('downloadTarball test-org/state-github@trunk');
    });

    it('discovers a claim among thousands of manifests without per-file API reads', async () => {
      const ref = { owner: 'test-org', repo: 'state-github' };
      const paths = Array.from({ length: 1000 }, (_, index) => `unrelated/${index}.yaml`);
      const api = createApi({});
      for (const path of paths) api.setFile(ref, path, 'kind: Unrelated');
      api.setFile(ref, 'target.yaml', 'metadata:\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app');

      const results = await findCrOnMainBranch(api, 'test-org/state-github', 'ComponentClaim', 'my-app');

      expect(results.map((cr) => cr.path)).toEqual(['target.yaml']);
      expect(api.calls.filter((call) => call.startsWith('readFile '))).toHaveLength(0);
      expect(api.calls.filter((call) => call.startsWith('downloadTarball '))).toEqual([
        'downloadTarball test-org/state-github@main',
      ]);
    });

    it('reports corrupt archives instead of silently skipping check discovery', async () => {
      const api = createApi({});
      api.tarball = Buffer.from('not a tar archive');

      await expect(findCrOnMainBranch(api, 'test-org/state-github', 'ComponentClaim', 'my-app')).rejects.toThrow('TAR_BAD_ARCHIVE');
    });

    it('returns empty array when no CRs match', async () => {
      const api = createApi({});

      const results = await findCrOnMainBranch(
        api,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(0);
    });

    it('returns empty array for invalid repo slug', async () => {
      const api = createApi({});

      const results = await findCrOnMainBranch(
        api,
        'invalid-repo-slug',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(0);
    });

    it('handles missing last-state-pr annotation', async () => {
      const api = createApi({
        'cr1.yaml@main':
          'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
      });

      const results = await findCrOnMainBranch(
        api,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(1);
      expect(results[0].lastStatePr).toBeNull();
    });

    it('filters out non-YAML files from the default-branch tree', async () => {
      const api = createApi({
        'cr1.yaml@main':
          'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
        'README.md@main': 'metadata:\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
      });

      const results = await findCrOnMainBranch(
        api,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('cr1.yaml');
    });
  });
});
