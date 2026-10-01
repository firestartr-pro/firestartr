import type { Octokit } from '@octokit/rest';
import logger from './logger';

const MAX_MULTIPART_COMMENTS = 100;

const locks = new Map<string, Promise<void>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  locks.set(
    key,
    prev.then(() => next),
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === next) locks.delete(key);
  }
}

// helpers
function escapeForRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function multiPartIdRegex(baseKind: string, index: number) {
  return new RegExp(
    `<!-- sticky-id:${escapeForRegex(baseKind)}\\[${index}\\]=(\\d+) -->`,
  );
}
function multiPartIdMarker(baseKind: string, index: number, id: number) {
  return `<!-- sticky-id:${baseKind}[${index}]=${id} -->`;
}
function multiPartBodyMarker(baseKind: string, index: number) {
  return `<!-- sticky:kind=${baseKind}[${index}] -->`;
}
// ---- Helpers for reducing API calls and duplication ----

async function getPrBody(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<string> {
  const prResp = await octokit.rest.pulls.get({ owner, repo, pull_number: pr });
  return prResp.data?.body ?? '';
}

async function updatePrBodyIfChanged(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  newBody: string,
  oldBody: string,
): Promise<void> {
  if (newBody !== oldBody) {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr,
      body: newBody,
    });
  }
}

async function updateComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
}

async function createCommentAndGetId(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
): Promise<number | undefined> {
  const created = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
  return created?.data?.id;
}

async function readMultiPartStickyIdsFromPrBody(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  baseKind: string,
): Promise<Map<number, number>> {
  const body = await getPrBody(octokit, owner, repo, pr);
  const ids = new Map<number, number>();

  // Find all indexed markers for this base kind
  // Break early once we encounter a gap (most comments are sequentially indexed)
  let consecutiveGaps = 0;
  for (let i = 0; i < MAX_MULTIPART_COMMENTS; i++) {
    const m = body.match(multiPartIdRegex(baseKind, i));
    if (m) {
      ids.set(i, Number(m[1]));
      consecutiveGaps = 0;
    } else {
      consecutiveGaps++;
      // Stop after finding 5 consecutive gaps (reasonable buffer for sparse indices)
      if (consecutiveGaps >= 5) break;
    }
  }

  return ids;
}

async function readMultiPartStickyIdsFromComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  baseKind: string,
): Promise<Map<number, number>> {
  const ids = new Map<number, number>();
  let page = 1;

  while (true) {
    const resp = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pr,
      per_page: 100,
      page,
    });

    for (const comment of resp.data) {
      const body = comment.body ?? '';

      for (let i = 0; i < MAX_MULTIPART_COMMENTS; i++) {
        if (body.includes(multiPartBodyMarker(baseKind, i))) {
          ids.set(i, comment.id);
        }
      }
    }

    if (resp.data.length < 100) return ids;

    page++;
  }
}

async function readMultiPartStickyIds(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  baseKind: string,
): Promise<Map<number, number>> {
  const ids = await readMultiPartStickyIdsFromPrBody(
    octokit,
    owner,
    repo,
    pr,
    baseKind,
  );

  if (ids.size > 0) return ids;

  return readMultiPartStickyIdsFromComments(octokit, owner, repo, pr, baseKind);
}

async function writeMultiPartStickyIdsToPrBody(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
  baseKind: string,
  ids: Map<number, number>,
) {
  const oldBody = await getPrBody(octokit, owner, repo, pr);
  let body = oldBody;

  // Determine the highest index we need to clean up
  // Add a small buffer to catch any stragglers from previous runs
  const maxIndex = ids.size > 0 ? Math.max(...ids.keys()) + 5 : 5;

  // Remove all old markers for this base kind (only up to needed range)
  for (let i = 0; i <= maxIndex && i < MAX_MULTIPART_COMMENTS; i++) {
    const rx = multiPartIdRegex(baseKind, i);
    body = body.replace(rx, '');
  }

  // Add all new markers
  let markers = '';
  ids.forEach((id, index) => {
    markers += `${multiPartIdMarker(baseKind, index, id)}\n`;
  });

  // Clean up extra newlines
  markers = markers.trim();

  let next = body.trim();
  if (markers) {
    next = next ? `${next}\n${markers}` : markers;
  }

  await updatePrBodyIfChanged(octokit, owner, repo, pr, next, oldBody);
}

export interface UpsertMultiPartStickyParams {
  owner: string;
  repo: string;
  pullNumber: number;
  /**
   * Base kind discriminator for multi-part comments
   * Creates comments with kinds: baseKind[0], baseKind[1], etc.
   */
  baseKind: string;
  /**
   * Array of comment bodies, one per part
   */
  bodies: string[];
}

/**
 * Upsert sticky comments for one or more parts.
 * Always uses indexed kinds (e.g., 'logs[0]', 'logs[1]', etc.) for consistency.
 *
 * Behavior:
 * - Single part (bodies.length === 1): Uses indexed kind like 'logs[0]'
 * - Multiple parts (bodies.length > 1): Uses indexed kinds 'logs[0]', 'logs[1]', etc.
 * - Non-last parts include a note about continuation
 * - Unused parts (from previous runs) are updated with a placeholder message
 * - Never deletes comments
 */
export async function upsertMultiPartStickyComments(
  octokit: Octokit,
  params: UpsertMultiPartStickyParams,
): Promise<void> {
  const { owner, repo, pullNumber, baseKind, bodies } = params;

  // Always use indexed kinds (e.g., 'logs[0]', 'logs[1]', etc.)
  const lockKey = `${owner}/${repo}#${pullNumber}#${baseKind}[multi]`;
  const totalParts = bodies.length;

  await withLock(lockKey, async () => {
    // Read existing comment IDs for this base kind
    const existingIds = await readMultiPartStickyIds(
      octokit,
      owner,
      repo,
      pullNumber,
      baseKind,
    );

    const newIds = new Map<number, number>();

    // Process each part of the new content
    for (let partIndex = 0; partIndex < totalParts; partIndex++) {
      const body = bodies[partIndex];
      const isLastPart = partIndex === totalParts - 1;

      // Build the full comment body with continuation notice for non-last parts
      let fullBody = body;
      if (!isLastPart) {
        fullBody += `\n\n📝 **Note:** This is part ${partIndex + 1} of ${totalParts}. See next comment for continuation.`;
      }
      fullBody += `\n\n${multiPartBodyMarker(baseKind, partIndex)}`;

      const existingId = existingIds.get(partIndex);

      if (existingId) {
        // Update existing comment
        await updateComment(octokit, owner, repo, existingId, fullBody);
        newIds.set(partIndex, existingId);
      } else {
        // Create new comment
        const newId = await createCommentAndGetId(
          octokit,
          owner,
          repo,
          pullNumber,
          fullBody,
        );
        if (newId !== undefined) {
          newIds.set(partIndex, newId);
        }
      }
    }

    // Handle old comments that are no longer needed (when new content is shorter)
    // Update them with a placeholder message instead of deleting, but keep their IDs for potential reuse
    for (const [oldIndex, oldId] of existingIds) {
      if (!newIds.has(oldIndex)) {
        const placeholderBody = `⚠️ This comment is no longer in use as the log output has been reduced.\n\n${multiPartBodyMarker(baseKind, oldIndex)}`;
        await updateComment(octokit, owner, repo, oldId, placeholderBody);
        newIds.set(oldIndex, oldId); // Preserve ID in PR body for reuse
      }
    }

    // Update PR body with all comment IDs
    await writeMultiPartStickyIdsToPrBody(
      octokit,
      owner,
      repo,
      pullNumber,
      baseKind,
      newIds,
    );
  });
}
