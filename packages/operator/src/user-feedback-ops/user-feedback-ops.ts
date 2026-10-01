import github from 'github';

import log from '../logger';

function operatorProfile() {
  return github.withProfile('operator');
}
import {
  getPrInfoFromAnnotation,
  LAST_STATE_PR_ANNOTATION,
} from '../pr-annotation';

/**
 * Minimal shape of a CR the apply progress comment needs: its kind and
 * its resource name.
 */
interface ProgressCommentResource {
  kind: string;
  metadata?: { name?: string };
}

function resolveProgressCommentResource(item: ProgressCommentResource): {
  kind: string;
  name: string;
} {
  return { kind: item.kind, name: item.metadata?.name ?? 'unknown' };
}

/**
 * Single builder of the sticky base kind shared by the apply progress
 * comment (upserted by the check run while the operation runs) and the
 * final result publisher (which updates that same comment in place).
 * Keyed per resource so claims of the same kind never overwrite each
 * other's feedback.
 */
export function progressCommentBaseKind(
  cmd: string,
  item: ProgressCommentResource,
): string {
  const { kind, name } = resolveProgressCommentResource(item);
  return `${cmd}:${kind}:${name}`;
}

/**
 * Body of the apply progress comment. The check-run module appends the
 * `[here](<check-run-url>)` link to it.
 */
export function progressCommentText(
  cmd: string,
  item: ProgressCommentResource,
): string {
  const { kind, name } = resolveProgressCommentResource(item);
  return `The ${kind} '${name}' is being processed (cmd=${cmd}). Details: `;
}

export async function tryPublishApply(
  item: any,
  planOutput: string,
  isSuccess = true,
  exitCode?: number,
) {
  const kind = item.kind;
  const metadataName = item.metadata?.name ?? 'unknown';

  try {
    const annotations = item.metadata?.annotations;

    if (!annotations || !(LAST_STATE_PR_ANNOTATION in annotations)) {
      log.debug(
        `The user feedback for the '${kind}/${metadataName}' apply operation could not be published because the last state was not found.`,
      );
      return;
    }

    const effectiveSuccess =
      isSuccess && (exitCode === undefined || exitCode === 0);

    if (isSuccess && exitCode !== undefined && exitCode !== 0) {
      log.warn(
        `The user feedback for the '${kind}/${metadataName}' apply operation was downgraded to failure because terraform exited with code '${exitCode}'.`,
      );
    }

    await publishApply(item, planOutput, effectiveSuccess);
  } catch (e: any) {
    log.error(
      `The user feedback for the '${kind}/${metadataName}' apply operation failed to publish due to an error: '${e}'.`,
    );
  }
}

export async function tryPublishDestroy(
  item: any,
  destroyOutput: string,
  isSuccess = true,
) {
  const kind = item.kind;

  try {
    const prInfo = getPrInfoFromAnnotation(item, LAST_STATE_PR_ANNOTATION);

    if (!prInfo) return;

    const { repo, owner: org, prNumber } = prInfo;

    log.debug(
      `The user feedback for the '${item.kind}/${item.metadata.name}' destroy operation is being published for repository '${repo}' in organization '${org}' on PR '${prNumber}'.`,
    );

    const dividedOutput: string[] = github.pulls.divideCommentIntoChunks(
      destroyOutput,
      250,
    );

    const statusEmoji = isSuccess ? '✅' : '❌';
    const statusText = isSuccess ? 'Succeeded' : 'Failed';

    const commentBodies = dividedOutput.map((commentContent, index) => {
      const isMultiPart = dividedOutput.length > 1;
      const partIndicator = isMultiPart ? ` (Part ${index + 1})` : '';
      return `<h1>
<img  width="25"  src="https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/logos/square-nobg.png"> Destroy ${statusText} ${statusEmoji}
</h1>
<p><b>${kind}: </b>${item.metadata.name}</p>

<details id=github>
<summary>DESTROY LOGS${partIndicator}</summary>

\`\`\`shell
${commentContent}
\`\`\`
</details>`;
    });

    log.debug(
      `The user feedback for item '${item.kind}/${item.metadata.name}' is being published as a comment on pull request '${prNumber}' for repository '${repo}' in organization '${org}'.`,
    );

    // Get octokit instance for the org to use with upsertMultiPartStickyComments
    const octokit = await operatorProfile().auth.getOctokitForOrg(org);
    await operatorProfile().feedback.upsertMultiPartStickyComments(octokit, {
      owner: org,
      repo,
      pullNumber: prNumber,
      baseKind: progressCommentBaseKind('destroy', item),
      bodies: commentBodies,
    });

    log.debug(
      `The user feedback for the '${item.kind}/${item.metadata.name}' destroy operation has been published as a comment on pull request '${prNumber}'.`,
    );
  } catch (e: any) {
    log.error(
      `An error occurred while publishing user feedback for item '${item.kind}/${item.metadata.name}': '${e}'.`,
    );
  }
}

export async function publishApply(
  item: any,
  applyOutput: string,
  isSuccess = true,
) {
  const kind = item.kind;
  const { prNumber, repo, org } = extractPrInfo(item);

  const dividedOutput: string[] = github.pulls.divideCommentIntoChunks(
    applyOutput,
    250,
  );

  const statusEmoji = isSuccess ? '✅' : '❌';
  const statusText = isSuccess ? 'Succeeded' : 'Failed';

  const commentBodies = dividedOutput.map((commentContent, index) => {
    const isMultiPart = dividedOutput.length > 1;
    const partIndicator = isMultiPart ? ` (Part ${index + 1})` : '';
    return `<h1>
<img  width="25"  src="https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/logos/square-nobg.png"> Apply ${statusText} ${statusEmoji}
</h1>
<p><b>${kind}: </b>${item.metadata.name}</p>

<details id=github>
<summary>APPLY LOGS${partIndicator}</summary>

\`\`\`shell
${commentContent}
\`\`\`
</details>`;
  });

  // Get octokit instance for the org to use with upsertMultiPartStickyComments
  const octokit = await operatorProfile().auth.getOctokitForOrg(org);
  await operatorProfile().feedback.upsertMultiPartStickyComments(octokit, {
    owner: org,
    repo,
    pullNumber: prNumber,
    baseKind: progressCommentBaseKind('apply', item),
    bodies: commentBodies,
  });
}

export function tryCreateErrorSummary(title: string, errorMsg: string) {
  try {
    let summaryText: string = title;

    summaryText += ':\n\n```';

    const splittedErrorMsg: string[] = errorMsg.split('\\n');

    for (const split of splittedErrorMsg) {
      summaryText += split;

      summaryText += '\n';
    }

    summaryText += '```';

    return summaryText;
  } catch (e: any) {
    log.error(
      `An error occurred while getting the error summary for '${title}'. The error was '${e}', with the message: '${errorMsg}'.`,
    );
    return `Error when getting error summary: ${e}`;
  }
}

export function extractPrInfo(
  item: any,
  annotation:
    | 'firestartr.dev/last-state-pr'
    | 'firestartr.dev/pull-request-plan' = LAST_STATE_PR_ANNOTATION,
): { prNumber: number; repo: string; org: string } {
  const prInfo = item.metadata.annotations[annotation];

  if (!prInfo) throw new Error(`No ${annotation} annotation found in CR`);

  const prNumber = prInfo.split('#')[1];

  if (!prNumber) throw new Error('No PR number found in CR');

  const org = prInfo.split('#')[0].split('/')[0];

  if (!org) throw new Error('No org found in CR');

  const repo = prInfo.split('#')[0].split('/')[1];

  if (!repo) throw new Error('No repo found in CR');

  const prNumberInt = parseInt(prNumber, 10);
  if (isNaN(prNumberInt)) {
    throw new Error(`Invalid PR number found in CR: '${prNumber}'`);
  }
  return { prNumber: prNumberInt, repo, org };
}

export async function tryPublishError(
  item: any,
  reason: string,
  message: string,
) {
  try {
    await publishError(item, reason, message);
  } catch (e: any) {
    log.error(
      `The user feedback for item '${item.kind}/${item.metadata.name}' failed to publish due to an error: '${e}'. Reason: '${reason}'.`,
    );
  }
}

export async function publishError(item: any, reason: string, message: string) {
  const { prNumber, repo, org } = extractPrInfo(item);

  const comment = `# ❌ Error on claim ${item.metadata.annotations['firestartr.dev/claim-ref'].split('/')[1]}
### 📝 Reason: ${reason}
#### ℹ️ Details:
${message}
`;

  await operatorProfile().pulls.commentInPR(
    comment,
    prNumber,
    repo,
    org,
    'logs',
  );
}

export async function publishPlan(
  item: any,
  planOutput: string,
  prNumber: number,
  repo: string,
  org: string,
  isSuccess = true,
  operation = 'plan',
  source = '',
) {
  try {
    const kind = item.kind || 'UnknownKind';
    const name =
      item.metadata?.name || item.metadata?.generateName || 'unknown';
    const dividedOutput: string[] = github.pulls.divideCommentIntoChunks(
      planOutput,
      250,
    );

    const statusEmoji = isSuccess ? '✅' : '❌';
    const statusText = isSuccess ? 'Succeeded' : 'Failed';
    const operationTitle = operation
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-');

    const commentBodies = dividedOutput.map((commentContent, index) => {
      const isMultiPart = dividedOutput.length > 1;
      const partIndicator = isMultiPart ? ` (Part ${index + 1})` : '';
      return `<h1>
<img  width="25"  src="https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/logos/square-nobg.png"> ${operationTitle} ${statusText} ${statusEmoji}
</h1>
<p><b>${kind}: </b>${name}</p>

<details id=github>
<summary>PLAN LOGS${partIndicator}</summary>

\`\`\`shell
${commentContent}
\`\`\`
</details>`;
    });

    // Get octokit instance for the org to use with upsertMultiPartStickyComments
    const octokit = await operatorProfile().auth.getOctokitForOrg(org);
    await operatorProfile().feedback.upsertMultiPartStickyComments(octokit, {
      owner: org,
      repo,
      pullNumber: prNumber,
      baseKind: [kind.toLowerCase(), name, operation, source]
        .filter(Boolean)
        .join(':'),
      bodies: commentBodies,
    });
  } catch (e: any) {
    console.error(e);
  }
}
