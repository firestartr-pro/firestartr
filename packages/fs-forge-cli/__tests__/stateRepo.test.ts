import { findCrOnMainBranch, formatPrState } from '../src/claims/stateRepo';
import { ClaimsClient } from '../src/claims/client';

function createMockClient(
  searchResults: Array<{ path: string; name: string }>,
  fileContents: Record<string, string | null>,
  defaultBranch = 'main',
): ClaimsClient {
  const mockOctokit = {
    rest: {
      repos: {
        get: async () => ({
          data: { default_branch: defaultBranch },
        }),
        getContent: async ({
          path,
          ref,
        }: {
          path: string;
          ref: string;
        }) => {
          const key = `${path}@${ref}`;
          const content = fileContents[key];
          if (content === undefined || content === null) {
            throw { status: 404 };
          }
          return {
            data: {
              type: 'file',
              content: Buffer.from(content).toString('base64'),
            },
          };
        },
      },
      search: {
        code: async ({
          q,
          per_page,
          page,
        }: {
          q: string;
          per_page: number;
          page: number;
        }) => {
          const start = ((page ?? 1) - 1) * per_page;
          return {
            data: {
              total_count: searchResults.length,
              items: searchResults.slice(start, start + per_page).map((r) => ({
                path: r.path,
                name: r.name,
                repository: { full_name: 'test-org/state-github' },
              })),
            },
          };
        },
      },
      pulls: {
        get: async ({
          pull_number,
        }: {
          pull_number: number;
        }) => ({
          data: {
            number: pull_number,
            html_url: `https://github.com/test/repo/pull/${pull_number}`,
            state: 'closed',
            merged: true,
          },
        }),
      },
    },
  };

  return new ClaimsClient('test-org', mockOctokit as never);
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
      const client = createMockClient(
        [
          { path: 'cr1.yaml', name: 'cr1.yaml' },
        ],
        {
          'cr1.yaml@main':
            'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app\n    firestartr.dev/last-state-pr: state-github#100',
        },
      );

      const results = await findCrOnMainBranch(
        client,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(1);
      expect(results[0].kind).toBe('FirestartrGithubRepository');
      expect(results[0].lastStatePr?.number).toBe(100);
    });

    it('returns empty array when no CRs match', async () => {
      const client = createMockClient([], {});

      const results = await findCrOnMainBranch(
        client,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(0);
    });

    it('returns empty array for invalid repo slug', async () => {
      const client = createMockClient([], {});

      const results = await findCrOnMainBranch(
        client,
        'invalid-repo-slug',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(0);
    });

    it('handles missing last-state-pr annotation', async () => {
      const client = createMockClient(
        [
          { path: 'cr1.yaml', name: 'cr1.yaml' },
        ],
        {
          'cr1.yaml@main':
            'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-repo\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
        },
      );

      const results = await findCrOnMainBranch(
        client,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(1);
      expect(results[0].lastStatePr).toBeNull();
    });

    it('filters out non-YAML files from search results', async () => {
      const client = createMockClient(
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
        client,
        'test-org/state-github',
        'ComponentClaim',
        'my-app',
      );

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('cr1.yaml');
    });
  });
});
