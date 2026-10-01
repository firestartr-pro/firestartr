import { getOctokitForOrg } from './auth';

import log from './logger';
import { upsertMultiPartStickyComments } from './sticky_comment';

const commentMaxSize = 65535;

export async function commentInPR(
  comment: string,
  pr_number: number,
  repo: string,
  owner = 'prefapp',
  stickyKind?: string,
) {
  try {
    log.info(`Commenting ${comment} in PR ${pr_number} of ${owner}/${repo}`);

    const octokit = await getOctokitForOrg(owner);

    if (stickyKind) {
      await upsertMultiPartStickyComments(octokit, {
        owner,
        repo,
        pullNumber: pr_number,
        baseKind: stickyKind,
        bodies: [comment],
      });
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pr_number,
        body: comment,
      });
    }
  } catch (e: any) {
    console.error(`Error commenting in PR: ${e}`);

    throw e;
  }
}

async function getPrData(
  pull_number: number,
  repo: string,
  owner: string,
): Promise<any> {
  const octokit = await getOctokitForOrg(owner);

  return await octokit.rest.pulls.get({ owner, repo, pull_number });
}

export async function getPrLastCommitSHA(
  pull_number: number,
  repo: string,
  owner = 'prefapp',
): Promise<string> {
  log.info(`Getting last commit SHA for PR ${pull_number} of ${owner}/${repo}`);

  const prData = await getPrData(pull_number, repo, owner);

  return prData.data.head.sha;
}

export async function getPrMergeCommitSHA(
  pull_number: number,
  repo: string,
  owner = 'prefapp',
): Promise<string> {
  log.info(
    `Getting merge commit SHA for PR ${pull_number} of ${owner}/${repo}`,
  );

  const prData = await getPrData(pull_number, repo, owner);

  if (prData.data.merge_commit_sha !== null) {
    return prData.data.merge_commit_sha;
  }

  throw new Error(`No merge_commit_sha value in prData.data: ${prData.data}`);
}

export async function getPrBaseSHA(
  pull_number: number,
  repo: string,
  owner = 'prefapp',
): Promise<string> {
  log.info(`Getting base SHA for PR ${pull_number} of ${owner}/${repo}`);

  const prData = await getPrData(pull_number, repo, owner);

  return prData.data.base.sha;
}

/*
 * Receives a comment, splits it into commentMaxSize sized chunks and returns
 * the resulting list
 *
 * Inputs:
 * - comment: the comment to split
 * - sizeReduction: when the function is used to process only part of a comment
 * (e.g. when composing a comment with a title, markdown and the actual comment
 * body being a really long output message like a TF plan or git diff) this
 * value can be set to reduce commentMaxSize and ensure the extra non-comment
 * characters with the comment don't exceed 65535 characters
 *
 * Returns: a list of strings, containing comment divided in
 * floor(comment.length / (commentMaxSize - sizeReduction)) + 1 parts
 *
 */
export function divideCommentIntoChunks(comment: string, sizeReduction = 0) {
  const maxCommentLength: number = commentMaxSize - sizeReduction;

  let currentComment: string = comment;

  const result: string[] = [];

  while (currentComment.length > maxCommentLength) {
    const dividedOutput: string = currentComment.substring(0, maxCommentLength);

    result.push(dividedOutput);

    currentComment = currentComment.substring(maxCommentLength);
  }

  // When currentComment.length < maxCommentLength, the remaining output is not
  // added unless we do this
  result.push(currentComment);

  return result;
}

export async function getPrFiles(
  pr_number: number,
  repo: string,
  owner = 'prefapp',
): Promise<any> {
  log.info(`Getting PR details of PR ${pr_number} of ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);
  const data: any[] = [];
  let page = 1;

  while (true) {
    const resp = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pr_number,
      per_page: 100,
      page,
    });

    data.push(...resp.data);

    if (resp.data.length < 100) {
      return { ...resp, data };
    }

    page++;
  }
}

async function filterPrBy(
  filter: {
    title: string;
    state: 'open' | 'closed' | 'all';
    repo: string;
    owner: string;
    userType: 'Bot' | 'User';
  },

  opts: {
    maxRetries: number;
  },
) {
  let foundPr = null;
  let retries = 0;

  const { title, state, repo, owner, userType } = filter;
  const { maxRetries } = opts;

  const octokit = await getOctokitForOrg(owner);

  while (retries < maxRetries) {
    const resp = await octokit.rest.pulls.list({
      owner,
      repo,
      state,
      per_page: 100,
      page: retries,
    });

    foundPr = resp.data.find((pr) => {
      return pr.title.includes(title) && pr?.user?.type === userType;
    });

    if (foundPr) return foundPr;

    retries++;
  }
}

export default {
  commentInPR,
  getPrLastCommitSHA,
  getPrMergeCommitSHA,
  getPrBaseSHA,
  divideCommentIntoChunks,
  getPrFiles,
  filterPrBy,
};
