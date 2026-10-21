import { t as listArchive } from 'tar';
import { parseDocument } from 'yaml';

import { extractLastStatePrFromContent } from './wetPr.js';

import type { GitHubApi } from '../github/api.js';

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

export async function findCrOnMainBranch(
  api: GitHubApi,
  stateRepo: string,
  claimType: string,
  claimName: string,
): Promise<CrInfo[]> {
  const slashIdx = stateRepo.indexOf('/');
  if (slashIdx < 0) return [];
  const owner = stateRepo.slice(0, slashIdx);
  const repo = stateRepo.slice(slashIdx + 1);

  const ref = { owner, repo };
  const defaultBranch = await api.getDefaultBranch(ref);
  const claimRef = `${claimType}/${claimName}`;
  const yamlFiles = await readYamlArchive(
    await api.downloadTarball(ref, defaultBranch),
  );

  const results: CrInfo[] = [];

  for (const { path: filePath, content } of yamlFiles) {
    const document = parseDocument(content);
    if (document.errors.length > 0) continue;
    const annotation = document.getIn([
      'metadata',
      'annotations',
      CLAIM_REF_ANNOTATION,
    ]);
    if (typeof annotation !== 'string' || annotation.trim() !== claimRef)
      continue;

    const kindMatch = content.match(/^kind\s*:\s*(.+)$/m);
    const nameMatch = content.match(/^ {2}name\s*:\s*(.+)$/m);

    const lastStatePr = extractLastStatePrFromContent(content, owner);
    const prInfo = lastStatePr ? await enrichPrInfo(api, lastStatePr) : null;

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

async function readYamlArchive(
  archive: Buffer,
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  await new Promise<void>((resolve, reject) => {
    const parser = listArchive({
      strict: true,
      filter: (path, entry) =>
        /\.ya?ml$/i.test(path) &&
        'type' in entry &&
        ['File', 'OldFile'].includes(entry.type),
      onReadEntry: (entry) => {
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => chunks.push(chunk));
        entry.on('end', () => {
          files.push({
            path: entry.path.split('/').slice(1).join('/'),
            content: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    });
    parser.once('error', reject);
    parser.once('end', resolve);
    parser.end(archive);
  });
  return files;
}

async function enrichPrInfo(
  api: GitHubApi,
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
    const pr = await api.getPullRequest({ owner, repo }, parsed.number);
    return {
      repo: repoSlug,
      number: parsed.number,
      state: pr.state,
      url: pr.htmlUrl,
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
