import { Octokit } from '@octokit/rest';

import { NO_AUTH_MESSAGE, resolveAuth } from '../context/auth.js';
import { createOctokitApi } from './octokitApi.js';

import type { GitHubApi } from './api.js';

/**
 * `@octokit/rest` bundles the request-log plugin, whose default logger is
 * `console`: a 404 on an expected probe lands on stderr as a request line and
 * mixes with command output. The CLI reports failures itself, so keep Octokit
 * quiet.
 */
const SILENT_LOG = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Production construction point for the GitHub port. */
export function createGitHubApi(
  token: string | undefined = resolveAuth()?.token,
): GitHubApi {
  if (!token) {
    throw new Error(NO_AUTH_MESSAGE);
  }
  return createOctokitApi(new Octokit({ auth: token, log: SILENT_LOG }));
}
