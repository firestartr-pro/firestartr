import * as fs from 'fs';
import common from 'catalog_common';
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

describe('configGit / removeGitConfig (SC-04)', () => {
  beforeEach(() => {
    existsSync.mockClear();
    rmSync.mockClear();
    writeFileSync.mockClear();
    existsSync.mockReturnValue(false);
    process.env[common.types.envVars.org] = 'test-org';
    delete process.env.TFM_SKIP_GIT_CONFIG;
  });

  afterEach(() => {
    delete process.env.TFM_SKIP_GIT_CONFIG;
    delete process.env[common.types.envVars.org];
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
    expect(writeFileSync.mock.calls[0][2]).toEqual({ mode: 0o600 });
  });

  it('removes any existing credential file in TFM_SKIP_GIT_CONFIG mode and writes nothing', async () => {
    existsSync.mockReturnValue(true);
    process.env.TFM_SKIP_GIT_CONFIG = 'true';

    await configGit();

    expect(rmSync).toHaveBeenCalledWith(GITCONFIG_PATH);
    expect(writeFileSync).not.toHaveBeenCalled();
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