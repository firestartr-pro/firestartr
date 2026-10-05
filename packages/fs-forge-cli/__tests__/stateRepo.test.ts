import { formatPrState, findCrOnMainBranch } from '../src/claims/stateRepo';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { RepoRef } from '../src/github/api';

function createApi(
  searchResults: Array<{ path: string; name: string }>,
  fileContents: Record<string, string | null>,
  defaultBranch = 'main',
  pullState = 'merged',
  pullNumbers: number[] = [100],
): MemoryGitHubApi {
  const ref: RepoRef = { owner: 'test-org', repo: 'state-github' };
  const api = new MemoryGitHubApi();
  api.setDefaultBranch(ref, defaultBranch);
  api.setSearchResults(ref, searchResults);
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
    it('formats merged state', () => {
      expect(formatPrState('merged')).toBe('merged');
    });

    it('formats open state', () => {
      expect(formatPrState('open')).toBe('open');
    });

    it('formats closed state', () => {
      expect(formatPrState('closed')).toBe('closed (not merged)');
    });

    it('formats null state', () => {
      expect(formatPrState(null)).toBe('unknown');
    });
  });

  describe('findCrOnMainBranch', () => {
    it('finds CRs by claim-ref annotation using code search', async () => {
      const api = createApi(
        [{ path: 'cr1.yaml', name: 'cr1.yaml' }],
        {
          'cr1.yaml@main':
            'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app\n    firestartr.dev/last-state-pr: state-github#100',
        },
      );

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
        'searchFiles test-org/state-github:"firestartr.dev/claim-ref: ComponentClaim/my-app"',
      );
    });

    it('returns empty array when no CRs match', async () => {
      const api = createApi([], {});

      const results = await findCrOnMainBranch(
        api,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(0);
    });

    it('returns empty array for invalid repo slug', async () => {
      const api = createApi([], {});

      const results = await findCrOnMainBranch(
        api,
        'invalid-repo-slug',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(0);
    });

    it('handles missing last-state-pr annotation', async () => {
      const api = createApi(
        [{ path: 'cr1.yaml', name: 'cr1.yaml' }],
        {
          'cr1.yaml@main':
            'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
        },
      );

      const results = await findCrOnMainBranch(
        api,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(1);
      expect(results[0].lastStatePr).toBeNull();
    });

    it('filters out non-YAML files from search results', async () => {
      const api = createApi(
        [
          { path: 'cr1.yaml', name: 'cr1.yaml' },
          { path: 'README.md', name: 'README.md' },
        ],
        {
          'cr1.yaml@main':
            'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
        },
      );

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
