import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'child_process';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));

import { readGhAuthToken, resolveAuth } from '../src/context/auth';
import { createGitHubApi } from '../src/github/index';

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;
const FakeExecFileSync = execFileSync as unknown as jest.Mock;

const FAKE_TOKEN = 'ghs_fake_token_for_tests';

function ghPrints(token: string): void {
  FakeExecFileSync.mockReturnValue(`${token}\n`);
}

function ghFails(error: NodeJS.ErrnoException): void {
  FakeExecFileSync.mockImplementation(() => {
    throw error;
  });
}

beforeEach(() => {
  FakeExecFileSync.mockReset();
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
  }
});

describe('gh auth token fallback', () => {
  it('reads and trims the github.com token regardless of GH_HOST', () => {
    ghPrints(FAKE_TOKEN);

    expect(readGhAuthToken()).toBe(FAKE_TOKEN);
    expect(resolveAuth({})).toEqual({
      token: FAKE_TOKEN,
      source: 'gh',
    });
    expect(FakeExecFileSync).toHaveBeenCalledWith(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('treats a logged-out gh as no token', () => {
    ghFails(Object.assign(new Error('Command failed: gh auth token'), { status: 1 }));

    expect(readGhAuthToken()).toBeUndefined();
    expect(resolveAuth({})).toBeUndefined();
  });

  it('treats a missing gh as no token', () => {
    ghFails(
      Object.assign(new Error('spawnSync gh ENOENT'), {
        code: 'ENOENT',
      }),
    );

    expect(readGhAuthToken()).toBeUndefined();
    expect(resolveAuth({})).toBeUndefined();
  });

  it('treats empty gh output as no token', () => {
    ghPrints('   ');

    expect(resolveAuth({})).toBeUndefined();
  });

  it('prefers GITHUB_TOKEN and never shells out to gh', () => {
    ghPrints(FAKE_TOKEN);

    expect(resolveAuth({ GITHUB_TOKEN: 'env-token' })).toEqual({
      token: 'env-token',
      source: 'GITHUB_TOKEN',
    });
    expect(FakeExecFileSync).not.toHaveBeenCalled();
  });

  it('authenticates the GitHub port with the gh token when GITHUB_TOKEN is unset', () => {
    ghPrints(FAKE_TOKEN);

    expect(createGitHubApi()).toBeDefined();
    expect(FakeExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('fails without a token when neither GITHUB_TOKEN nor gh is available', () => {
    ghFails(Object.assign(new Error('Command failed'), { status: 1 }));

    expect(() => createGitHubApi()).toThrow('GITHUB_TOKEN is required');
  });

  it('keeps the token out of stdout and stderr', () => {
    ghPrints(FAKE_TOKEN);
    const written: string[] = [];
    const stdout = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(chunk.toString());
        return true;
      });
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(chunk.toString());
        return true;
      });
    try {
      createGitHubApi();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    expect(written).toEqual([]);
  });
});
