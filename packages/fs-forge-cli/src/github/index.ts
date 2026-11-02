import { Octokit } from '@octokit/rest';

import { NO_AUTH_MESSAGE, resolveAuth } from '../context/auth.js';
import { createOctokitApi } from './octokitApi.js';

import type { GitHubApi } from './api.js';

/** Production construction point for the GitHub port. */
export function createGitHubApi(
  token: string | undefined = resolveAuth()?.token,
): GitHubApi {
  if (!token) {
    throw new Error(NO_AUTH_MESSAGE);
  }
  return createOctokitApi(new Octokit({ auth: token }));
}
