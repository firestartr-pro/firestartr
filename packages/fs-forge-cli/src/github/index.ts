import { Octokit } from '@octokit/rest';

import { createOctokitApi } from './octokitApi.js';

import type { GitHubApi } from './api.js';

/** Production construction point for the GitHub port. */
export function createGitHubApi(
  token: string | undefined = process.env.GITHUB_TOKEN,
): GitHubApi {
  if (!token) throw new Error('GITHUB_TOKEN is required');
  return createOctokitApi(new Octokit({ auth: token }));
}
