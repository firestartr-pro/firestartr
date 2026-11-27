import { describe, expect, it, jest } from '@jest/globals';

const octokitOptions: Array<{ log?: Record<string, unknown> }> = [];

jest.mock('@octokit/rest', () => ({
  Octokit: class {
    constructor(options: { log?: Record<string, unknown> }) {
      octokitOptions.push(options);
    }
  },
}));

import { createGitHubApi } from '../src/github/index';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

describe('createGitHubApi', () => {
  it('keeps Octokit request logging out of stdout and stderr', () => {
    const stdout = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      createGitHubApi('ghs_fake_token_for_tests');

      const log = octokitOptions.at(-1)?.log as
        | Record<LogLevel, (message: string) => void>
        | undefined;
      expect(log).toBeDefined();
      for (const level of ['debug', 'info', 'warn', 'error'] as const) {
        log?.[level]('GET /repos/acme/hello-api - 404 with id 1 in 302ms');
      }

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
