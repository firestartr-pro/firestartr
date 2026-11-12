import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import common from 'catalog_common';
import github from 'github';
import { configGit, removeGitConfig } from '../src/utils';

/*
 * External-behaviour tests for SC-04 (#2821): the git rewrite rule must be
 * host-bounded (trailing slash), the credential file must be written 0600, and
 * it must be removable once the git-dependent work is done.
 *
 * The `github` module is dynamically imported inside `configGit`, and the `fs`
 * module is mocked, so no real /home/node is touched and no real token is used.
 */
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(() => false),
    rmSync: jest.fn(),
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
  };
});

jest.mock('github', () => ({
  __esModule: true,
  default: {
    getGithubAppToken: jest.fn().mockResolvedValue('fake-token'),
  },
}));

const GITCONFIG_PATH = '/home/node/.gitconfig';

const existsSync = fs.existsSync as jest.Mock;
const rmSync = fs.rmSync as jest.Mock;
const writeFileSync = fs.writeFileSync as jest.Mock;
const renameSync = fs.renameSync as jest.Mock;
const getGithubAppToken = github.getGithubAppToken as jest.Mock;

describe('configGit / removeGitConfig (SC-04)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    existsSync.mockReturnValue(false);
    getGithubAppToken.mockResolvedValue('fake-token');
    process.env[common.types.envVars.org] = 'test-org';
    delete process.env.TFM_SKIP_GIT_CONFIG;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TFM_SKIP_GIT_CONFIG;
    delete process.env[common.types.envVars.org];
  });

  it('registers exit cleanup only once across successful refreshes', async () => {
    const once = jest.spyOn(process, 'once');

    await configGit();
    await configGit();

    const exitCalls = once.mock.calls.filter(([event]) => event === 'exit');
    expect(exitCalls).toEqual([['exit', removeGitConfig]]);
    existsSync.mockReturnValue(true);
    (exitCalls[0][1] as () => void)();
    expect(rmSync).toHaveBeenCalledWith(GITCONFIG_PATH);
  });

  it('preserves the existing config while the token request is pending', async () => {
    existsSync.mockReturnValue(true);
    let resolveToken!: (token: string) => void;
    let tokenRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      tokenRequested = resolve;
    });
    getGithubAppToken.mockImplementation(() => {
      tokenRequested();
      return new Promise<string>((resolve) => {
        resolveToken = resolve;
      });
    });

    const refresh = configGit();
    await requested;
    try {
      expect(rmSync).not.toHaveBeenCalled();
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(renameSync).not.toHaveBeenCalled();
    } finally {
      resolveToken('fake-token');
      await refresh;
    }
  });

  it('writes a same-directory temporary file before atomically replacing the config', async () => {
    existsSync.mockReturnValue(true);
    await configGit();

    const [tempPath] = writeFileSync.mock.calls[0];
    expect(path.dirname(tempPath)).toBe(path.dirname(GITCONFIG_PATH));
    expect(tempPath).not.toBe(GITCONFIG_PATH);
    expect(tempPath).toMatch(/\.tmp$/);
    expect(renameSync).toHaveBeenCalledWith(tempPath, GITCONFIG_PATH);
    expect(writeFileSync.mock.invocationCallOrder[0]).toBeLessThan(
      renameSync.mock.invocationCallOrder[0],
    );
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('preserves the config when token retrieval fails', async () => {
    existsSync.mockReturnValue(true);
    const error = new Error('token failed');
    getGithubAppToken.mockRejectedValue(error);

    await expect(configGit()).rejects.toBe(error);
    expect(rmSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
  });

  it.each(['write', 'rename'])('cleans up after a %s failure without masking the error', async (operation) => {
    const error = new Error(`${operation} failed`);
    const failingOperation = operation === 'write' ? writeFileSync : renameSync;
    failingOperation.mockImplementation(() => {
      throw error;
    });
    rmSync.mockImplementation(() => {
      throw new Error('cleanup failed');
    });

    await expect(configGit()).rejects.toBe(error);
    const [tempPath] = writeFileSync.mock.calls[0];
    expect(rmSync).toHaveBeenCalledWith(tempPath, { force: true });
    expect(rmSync).not.toHaveBeenCalledWith(GITCONFIG_PATH);
    if (operation === 'write') expect(renameSync).not.toHaveBeenCalled();
  });

  it('replaces a wider-permission file with a real 0600 file and leaves no temporary file', async () => {
    const actual: typeof fs = jest.requireActual('fs');
    const directory = actual.mkdtempSync(path.join(os.tmpdir(), 'configgit-'));
    const destination = path.join(directory, '.gitconfig');
    const localPath = (file: string) => path.join(directory, path.basename(file));
    try {
      actual.writeFileSync(destination, 'previous config');
      actual.chmodSync(destination, 0o644);
      writeFileSync.mockImplementation((file, content, options) =>
        actual.writeFileSync(localPath(file), content, options),
      );
      renameSync.mockImplementation((source, target) =>
        actual.renameSync(localPath(source), localPath(target)),
      );

      await configGit();

      expect(actual.statSync(destination).mode & 0o777).toBe(0o600);
      expect(actual.readFileSync(destination, 'utf8')).toBe(
        '[url "https://firestartr:fake-token@github.com/"]\ninsteadOf = https://github.com/\n',
      );
      expect(actual.readdirSync(directory)).toEqual(['.gitconfig']);
    } finally {
      actual.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes a usable host-bounded rewrite: both the url base and insteadOf end in /', async () => {
    await configGit();

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [, content] = writeFileSync.mock.calls[0] as [string, string];
    // Complete rule so Git's prefix swap keeps the path separator:
    // https://github.com/org/repo.git → https://firestartr:token@github.com/org/repo.git
    expect(content).toBe(
      '[url "https://firestartr:fake-token@github.com/"]\ninsteadOf = https://github.com/\n',
    );
    // Must NOT silently match a look-alike host like github.com.attacker.tld,
    // and must NOT drop the slash on the replacement base (github.comorg/...).
    expect(content).not.toContain('insteadOf = https://github.com\n');
    expect(content).not.toContain('@github.com"]');
  });

  it('writes the credential file with user-only 0600 permissions', async () => {
    await configGit();

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync.mock.calls[0][2]).toEqual({ mode: 0o600, flag: 'wx' });
  });

  it('removes any existing credential file in TFM_SKIP_GIT_CONFIG mode and writes nothing', async () => {
    existsSync.mockReturnValue(true);
    process.env.TFM_SKIP_GIT_CONFIG = 'true';

    await configGit();

    expect(rmSync).toHaveBeenCalledWith(GITCONFIG_PATH);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
    expect(getGithubAppToken).not.toHaveBeenCalled();
  });

  it('removeGitConfig removes the file when present', () => {
    existsSync.mockReturnValue(true);

    removeGitConfig();

    expect(rmSync).toHaveBeenCalledWith(GITCONFIG_PATH);
  });

  it('removeGitConfig is a no-op when the file is absent', () => {
    existsSync.mockReturnValue(false);

    removeGitConfig();

    expect(rmSync).not.toHaveBeenCalled();
  });
});
