import {
  defaultStateRepos,
  extractLastStatePrFromContent,
  findWetPr,
  isDeletionPr,
  parseStateRepos,
} from '../src/claims/wetPr';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { PullRequestSummary, RepoRef } from '../src/github/api';

interface MockPr {
  number: number;
  html_url: string;
  state: string;
  head: { ref: string };
  base: { ref: string; sha: string };
  updated_at: string;
}

function createApi(
  prLists: Record<string, MockPr[]>,
  fileContents: Record<string, string | null> = {},
  fileLists: Record<string, Array<{ filename: string; status: string }>> = {},
): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  for (const [slug, prs] of Object.entries(prLists)) {
    const ref: RepoRef = parseRef(slug);
    const summaries: PullRequestSummary[] = prs.map((pr) => ({
      number: pr.number,
      htmlUrl: pr.html_url,
      state: pr.state,
      headRef: pr.head.ref,
      baseSha: pr.base.sha,
      updatedAt: pr.updated_at,
    }));
    api.setPullRequests(ref, summaries);
  }
  for (const [key, content] of Object.entries(fileContents)) {
    if (content === null) continue;
    const match = key.match(/^([^/]+)\/([^/]+)\/(.+?)@(.+)$/);
    if (!match) continue;
    api.setFile({ owner: match[1], repo: match[2] }, match[3], content);
  }
  for (const [key, files] of Object.entries(fileLists)) {
    const [slug, pr] = key.split('#');
    api.setPullRequestFiles(parseRef(slug), Number(pr), files);
  }
  return api;
}

function parseRef(slug: string): RepoRef {
  const [owner, repo] = slug.split('/');
  return { owner, repo };
}

describe('wetPr', () => {
  describe('parseStateRepos', () => {
    it('returns default repos when no flag provided', () => {
      const repos = parseStateRepos(undefined, 'my-org');
      expect(repos).toEqual(['my-org/state-github', 'my-org/state-infra']);
    });

    it('parses custom repos from flag', () => {
      const repos = parseStateRepos(
        'custom/state-one,custom/state-two',
        'my-org',
      );
      expect(repos).toEqual(['custom/state-one', 'custom/state-two']);
    });
  });

  describe('defaultStateRepos', () => {
    it('returns convention-based repos', () => {
      const repos = defaultStateRepos('test-org');
      expect(repos).toEqual(['test-org/state-github', 'test-org/state-infra']);
    });
  });

  describe('isDeletionPr', () => {
    it('returns true when all files are removed', () => {
      expect(
        isDeletionPr([
          { filename: 'cr1.yaml', status: 'removed' },
          { filename: 'cr2.yaml', status: 'removed' },
        ]),
      ).toBe(true);
    });

    it('returns false when files have mixed statuses', () => {
      expect(
        isDeletionPr([
          { filename: 'cr1.yaml', status: 'removed' },
          { filename: 'cr2.yaml', status: 'added' },
        ]),
      ).toBe(false);
    });

    it('returns false when no files exist', () => {
      expect(isDeletionPr([])).toBe(false);
    });

    it('returns false when files are added or modified', () => {
      expect(
        isDeletionPr([
          { filename: 'cr1.yaml', status: 'added' },
          { filename: 'cr2.yaml', status: 'modified' },
        ]),
      ).toBe(false);
    });
  });

  describe('extractLastStatePrFromContent', () => {
    it('parses valid last-state-pr annotation with owner/repo', () => {
      const content =
        'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  annotations:\n    firestartr.dev/last-state-pr: state-github#1184';
      const result = extractLastStatePrFromContent(content, 'test-org');
      expect(result).toEqual({
        owner: 'test-org',
        repo: 'test-org/state-github',
        number: 1184,
      });
    });

    it('parses annotation with owner/repo prefix', () => {
      const content =
        'metadata:\n  annotations:\n    firestartr.dev/last-state-pr: other-org/state-github#200';
      const result = extractLastStatePrFromContent(content, 'test-org');
      expect(result).toEqual({
        owner: 'other-org',
        repo: 'other-org/state-github',
        number: 200,
      });
    });

    it('returns null when annotation is missing', () => {
      const content =
        'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository';
      const result = extractLastStatePrFromContent(content, 'test-org');
      expect(result).toBeNull();
    });

    it('returns null when annotation value is malformed', () => {
      const content =
        'metadata:\n  annotations:\n    firestartr.dev/last-state-pr: invalid-value';
      const result = extractLastStatePrFromContent(content, 'test-org');
      expect(result).toBeNull();
    });
  });

  describe('findWetPr', () => {
    it('finds PR by branch name pattern', async () => {
      const api = createApi({
        'test-org/state-github': [
          {
            number: 100,
            html_url: 'https://github.com/test-org/state-github/pull/100',
            state: 'open',
            head: { ref: 'automated-componentclaim-my-app' },
            base: { ref: 'main', sha: 'abc123' },
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const result = await findWetPr(
        api,
        ['test-org/state-github'],
        'ComponentClaim',
        'my-app',
      );

      expect(result).not.toBeNull();
      expect(result?.number).toBe(100);
      expect(result?.repo).toBe('test-org/state-github');
      expect(api.calls).toContain(
        'listOpenPullRequests test-org/state-github:automated',
      );
    });

    it('returns null when no matching PR found', async () => {
      const api = createApi({
        'test-org/state-github': [
          {
            number: 100,
            html_url: 'https://github.com/test-org/state-github/pull/100',
            state: 'open',
            head: { ref: 'automated-other-claim' },
            base: { ref: 'main', sha: 'abc123' },
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const result = await findWetPr(
        api,
        ['test-org/state-github'],
        'ComponentClaim',
        'my-app',
      );

      expect(result).toBeNull();
    });

    it('selects most recent PR when multiple match', async () => {
      const api = createApi({
        'test-org/state-github': [
          {
            number: 99,
            html_url: 'https://github.com/test-org/state-github/pull/99',
            state: 'open',
            head: { ref: 'automated-componentclaim-my-app-old' },
            base: { ref: 'main', sha: 'abc123' },
            updated_at: '2024-01-01T00:00:00Z',
          },
          {
            number: 100,
            html_url: 'https://github.com/test-org/state-github/pull/100',
            state: 'open',
            head: { ref: 'automated-componentclaim-my-app' },
            base: { ref: 'main', sha: 'abc123' },
            updated_at: '2024-01-02T00:00:00Z',
          },
        ],
      });

      const result = await findWetPr(
        api,
        ['test-org/state-github'],
        'ComponentClaim',
        'my-app',
      );

      expect(result?.number).toBe(100);
    });

    it('falls back to content matching', async () => {
      const api = createApi(
        {
          'test-org/state-github': [
            {
              number: 100,
              html_url: 'https://github.com/test-org/state-github/pull/100',
              state: 'open',
              head: { ref: 'automated-something-else' },
              base: { ref: 'main', sha: 'abc123' },
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
        {
          'test-org/state-github/cr.yaml@automated-something-else':
            'kind: FirestartrGithubRepository\nmetadata:\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
        },
        {
          'test-org/state-github#100': [
            { filename: 'cr.yaml', status: 'added' },
          ],
        },
      );

      const result = await findWetPr(
        api,
        ['test-org/state-github'],
        'ComponentClaim',
        'my-app',
      );

      expect(result?.number).toBe(100);
    });

    it('detects deletion PR and sets lastStatePrRedirect', async () => {
      const api = createApi(
        {
          'test-org/state-github': [
            {
              number: 200,
              html_url: 'https://github.com/test-org/state-github/pull/200',
              state: 'open',
              head: { ref: 'automated-componentclaim-my-app' },
              base: { ref: 'main', sha: 'base123' },
              updated_at: '2024-01-03T00:00:00Z',
            },
          ],
        },
        {
          'test-org/state-github/cr.yaml@base123':
            'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-app\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app\n    firestartr.dev/last-state-pr: state-github#100',
        },
        {
          'test-org/state-github#200': [
            { filename: 'cr.yaml', status: 'removed' },
          ],
        },
      );

      const result = await findWetPr(
        api,
        ['test-org/state-github'],
        'ComponentClaim',
        'my-app',
      );

      expect(result).not.toBeNull();
      expect(result?.number).toBe(200);
      expect(result?.lastStatePrRedirect).toEqual({
        owner: 'test-org',
        repo: 'test-org/state-github',
        number: 100,
      });
    });

    it('does not set lastStatePrRedirect for non-deletion PR', async () => {
      const api = createApi({
        'test-org/state-github': [
          {
            number: 100,
            html_url: 'https://github.com/test-org/state-github/pull/100',
            state: 'open',
            head: { ref: 'automated-componentclaim-my-app' },
            base: { ref: 'main', sha: 'abc123' },
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const result = await findWetPr(
        api,
        ['test-org/state-github'],
        'ComponentClaim',
        'my-app',
      );

      expect(result).not.toBeNull();
      expect(result?.lastStatePrRedirect).toBeUndefined();
    });

    it('handles deletion PR with no last-state-pr annotation', async () => {
      const api = createApi(
        {
          'test-org/state-github': [
            {
              number: 200,
              html_url: 'https://github.com/test-org/state-github/pull/200',
              state: 'open',
              head: { ref: 'automated-componentclaim-my-app' },
              base: { ref: 'main', sha: 'base123' },
              updated_at: '2024-01-03T00:00:00Z',
            },
          ],
        },
        {
          'test-org/state-github/cr.yaml@base123':
            'apiVersion: firestartr.dev/v1\nkind: FirestartrGithubRepository\nmetadata:\n  name: my-app\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
        },
        {
          'test-org/state-github#200': [
            { filename: 'cr.yaml', status: 'removed' },
          ],
        },
      );

      const result = await findWetPr(
        api,
        ['test-org/state-github'],
        'ComponentClaim',
        'my-app',
      );

      expect(result).not.toBeNull();
      expect(result?.number).toBe(200);
      expect(result?.lastStatePrRedirect).toBeUndefined();
    });
  });
});
