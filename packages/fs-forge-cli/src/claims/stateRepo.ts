import type { ClaimsClient } from './client.js';

export interface CrInfo {
  owner: string;
  repo: string;
  path: string;
  kind: string;
  name: string;
  content: string;
  lastStatePr: LastStatePrInfo | null;
}

export interface LastStatePrInfo {
  repo: string;
  number: number;
  state: string | null;
  url: string | null;
}

const CLAIM_REF_ANNOTATION = 'firestartr.dev/claim-ref';
const LAST_STATE_PR_ANNOTATION = 'firestartr.dev/last-state-pr';

export async function findCrOnMainBranch(
  client: ClaimsClient,
  stateRepo: string,
  claimType: string,
  claimName: string,
): Promise<CrInfo[]> {
  const slashIdx = stateRepo.indexOf('/');
  if (slashIdx < 0) return [];
  const owner = stateRepo.slice(0, slashIdx);
  const repo = stateRepo.slice(slashIdx + 1);

  const defaultBranch = await client.getDefaultBranchForRepo(owner, repo);
  const claimRef = `${CLAIM_REF_ANNOTATION}: ${claimType}/${claimName}`;

  const searchResults = await client.searchCode(owner, repo, `"${claimRef}"`);

  const yamlFiles = searchResults.filter(
    (r) => r.path.endsWith('.yaml') || r.path.endsWith('.yml'),
  );

  const results: CrInfo[] = [];

  for (const { path: filePath } of yamlFiles) {
    const content = await client.getFileContent(
      owner,
      repo,
      filePath,
      defaultBranch,
    );
    if (!content) continue;

    const kindMatch = content.match(/^kind\s*:\s*(.+)$/m);
    const nameMatch = content.match(/^ {2}name\s*:\s*(.+)$/m);

    const lastStatePr = parseLastStatePrAnnotation(content, owner);
    const prInfo = lastStatePr ? await enrichPrInfo(client, lastStatePr) : null;

    results.push({
      owner,
      repo,
      path: filePath,
      kind: kindMatch?.[1]?.trim() ?? 'Unknown',
      name: nameMatch?.[1]?.trim() ?? 'Unknown',
      content,
      lastStatePr: prInfo,
    });
  }

  return results;
}

function parseLastStatePrAnnotation(
  content: string,
  defaultOwner: string,
): { owner: string; repo: string; number: number } | null {
  const escaped = LAST_STATE_PR_ANNOTATION.replace(/\./g, '\\.');
  const annotationRegex = `${escaped}\\s*:\\s*(.+)`;
  const match = content.match(new RegExp(annotationRegex));
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

async function enrichPrInfo(
  client: ClaimsClient,
  parsed: { owner: string; repo: string; number: number },
): Promise<LastStatePrInfo> {
  const repoSlug = parsed.repo;
  const slashIdx = repoSlug.indexOf('/');
  if (slashIdx < 0) {
    return { repo: repoSlug, number: parsed.number, state: null, url: null };
  }
  const owner = repoSlug.slice(0, slashIdx);
  const repo = repoSlug.slice(slashIdx + 1);

  try {
    const pr = await client.getPrByNumber(owner, repo, parsed.number);
    return {
      repo: repoSlug,
      number: parsed.number,
      state: pr.state,
      url: pr.html_url,
    };
  } catch {
    return { repo: repoSlug, number: parsed.number, state: null, url: null };
  }
}

export function formatPrState(state: string | null): string {
  switch (state) {
    case 'closed':
      return 'closed (not merged)';
    case 'open':
      return 'open';
    case 'merged':
      return 'merged';
    default:
      return 'unknown';
  }
}
