import type { GitHubApi, RepoRef } from '../github/api.js';

export interface WetPrInfo {
  owner: string;
  repo: string;
  number: number;
  url: string;
  headRef: string;
  baseRef: string;
  state: string;
  updatedAt: string;
  lastStatePrRedirect?: LastStatePrRedirect;
}

export interface LastStatePrRedirect {
  owner: string;
  repo: string;
  number: number;
}

const LAST_STATE_PR_ANNOTATION = 'firestartr.dev/last-state-pr';
const DEFAULT_STATE_REPOS = ['state-github', 'state-infra'];

function branchMatchesClaim(
  branchName: string,
  claimType: string,
  claimName: string,
): boolean {
  const normalized = branchName.toLowerCase();
  const kind = claimType.replace(/Claim$/i, '').toLowerCase();
  const name = claimName.toLowerCase();
  return (
    normalized.startsWith('automated') &&
    normalized.includes(kind) &&
    normalized.includes(name)
  );
}

function contentMatchesClaim(
  content: string,
  claimType: string,
  claimName: string,
): boolean {
  const ref = `${claimType}/${claimName}`;
  return content.includes(ref);
}

export function defaultStateRepos(org: string): string[] {
  return DEFAULT_STATE_REPOS.map((repo) => `${org}/${repo}`);
}

export function parseStateRepos(
  stateReposFlag: string | undefined,
  org: string,
): string[] {
  if (!stateReposFlag) return defaultStateRepos(org);
  return stateReposFlag.split(',').map((r) => r.trim());
}

export async function findWetPr(
  api: GitHubApi,
  stateRepos: string[],
  claimType: string,
  claimName: string,
): Promise<WetPrInfo | null> {
  let bestMatch: WetPrInfo | null = null;

  for (const repoSlug of stateRepos) {
    const slashIdx = repoSlug.indexOf('/');
    if (slashIdx < 0) continue;
    const owner = repoSlug.slice(0, slashIdx);
    const repo = repoSlug.slice(slashIdx + 1);

    const prs = await listOpenAutomatedPrs(api, { owner, repo });
    const matches = prs.filter((pr) =>
      branchMatchesClaim(pr.headRef, claimType, claimName),
    );

    if (matches.length > 0) {
      const mostRecent = matches.reduce((a, b) =>
        new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b,
      );

      const redirect = await handleDeletionPr(
        api,
        { owner, repo },
        mostRecent.number,
        mostRecent.baseRef,
        claimType,
        claimName,
      );
      if (redirect) {
        mostRecent.lastStatePrRedirect = redirect;
      }

      if (
        !bestMatch ||
        new Date(mostRecent.updatedAt) > new Date(bestMatch.updatedAt)
      ) {
        bestMatch = mostRecent;
      }
      continue;
    }

    const contentMatch = await findByContentFallback(
      api,
      { owner, repo },
      prs,
      claimType,
      claimName,
    );
    if (contentMatch) {
      const redirect = await handleDeletionPr(
        api,
        { owner, repo },
        contentMatch.number,
        contentMatch.baseRef,
        claimType,
        claimName,
      );
      if (redirect) {
        contentMatch.lastStatePrRedirect = redirect;
      }

      if (
        !bestMatch ||
        new Date(contentMatch.updatedAt) > new Date(bestMatch.updatedAt)
      ) {
        bestMatch = contentMatch;
      }
    }
  }

  return bestMatch;
}

async function listOpenAutomatedPrs(
  api: GitHubApi,
  ref: RepoRef,
): Promise<WetPrInfo[]> {
  const batch = await api.listOpenPullRequests(ref, 'automated');
  return batch.map((pr) => ({
    owner: ref.owner,
    repo: `${ref.owner}/${ref.repo}`,
    number: pr.number,
    url: pr.htmlUrl,
    headRef: pr.headRef,
    baseRef: pr.baseSha,
    state: pr.state,
    updatedAt: pr.updatedAt,
  }));
}

async function findByContentFallback(
  api: GitHubApi,
  ref: RepoRef,
  prs: WetPrInfo[],
  claimType: string,
  claimName: string,
): Promise<WetPrInfo | null> {
  for (const pr of prs) {
    const files = await api.listPullRequestFiles(ref, pr.number);
    for (const file of files) {
      if (!file.filename.endsWith('.yaml') && !file.filename.endsWith('.yml')) {
        continue;
      }
      const content = await api.readFile(ref, file.filename, pr.headRef);
      if (
        content &&
        contentMatchesClaim(content.content, claimType, claimName)
      ) {
        return pr;
      }
    }
  }
  return null;
}

export function isDeletionPr(
  files: Array<{ filename: string; status: string }>,
): boolean {
  if (files.length === 0) return false;
  return files.every((f) => f.status === 'removed');
}

export function extractLastStatePrFromContent(
  content: string,
  defaultOwner: string,
): LastStatePrRedirect | null {
  const escaped = LAST_STATE_PR_ANNOTATION.replace(/\./g, '\\.');
  const regex = new RegExp(`${escaped}\\s*:\\s*(.+)`);
  const match = content.match(regex);
  if (!match) return null;

  const value = match[1].trim();
  const repoPrMatch = value.match(/^((?:[^/]+\/)?[^#]+)#(\d+)$/);
  if (!repoPrMatch) return null;

  const rawRepo = repoPrMatch[1];
  const number = parseInt(repoPrMatch[2], 10);
  const repoSlug = rawRepo.includes('/')
    ? rawRepo
    : `${defaultOwner}/${rawRepo}`;
  const owner = repoSlug.split('/')[0]!;

  return { owner, repo: repoSlug, number };
}

async function resolveLastStatePrRedirect(
  api: GitHubApi,
  ref: RepoRef,
  prNumber: number,
  baseRef: string,
  claimType: string,
  claimName: string,
): Promise<LastStatePrRedirect | null> {
  const files = await api.listPullRequestFiles(ref, prNumber);
  const yamlFiles = files.filter(
    (f) => f.filename.endsWith('.yaml') || f.filename.endsWith('.yml'),
  );

  for (const file of yamlFiles) {
    const content = await api.readFile(ref, file.filename, baseRef);
    if (!content) continue;
    if (!contentMatchesClaim(content.content, claimType, claimName)) continue;

    return extractLastStatePrFromContent(content.content, ref.owner);
  }

  return null;
}

async function handleDeletionPr(
  api: GitHubApi,
  ref: RepoRef,
  prNumber: number,
  baseRef: string,
  claimType: string,
  claimName: string,
): Promise<LastStatePrRedirect | null> {
  const files = await api.listPullRequestFiles(ref, prNumber);
  if (!isDeletionPr(files)) return null;

  return resolveLastStatePrRedirect(
    api,
    ref,
    prNumber,
    baseRef,
    claimType,
    claimName,
  );
}
