import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
jest.mock('../src/context/version', () => ({
  latestCliVersion: jest.fn(async () => '9.9.9'),
}));

import Context from '../src/commands/context';
import { latestCliVersion } from '../src/context/version';
import { captureEnv, contextFixture } from './fixtures/contextFixtures';

const ROOT = process.cwd();
const CLI_VERSION = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
/** The directory `full.yaml` claims; it never has to exist on disk. */
const ACME_DIR = '/srv/acme';
const env = captureEnv();
/** The token `gh` would print; never a real one. */
const GH_TOKEN = 'ghs_fake_token_for_tests';

const FakeExecFileSync = execFileSync as unknown as jest.Mock;
const MockLatestCliVersion = latestCliVersion as unknown as jest.Mock<
  () => Promise<string | null>
>;

const cwd = jest.spyOn(process, 'cwd').mockReturnValue(ACME_DIR);

type ContextOutcome = Awaited<ReturnType<typeof run>>;

function useConfig(fixture: string): void {
  process.env.FS_FORGE_CONFIG = contextFixture(fixture);
}

function ghPrints(token: string): void {
  FakeExecFileSync.mockReturnValue(`${token}\n`);
}

async function run(...flags: string[]): Promise<{
  stdout: string;
  stderr: string;
  result?: unknown;
  error?: { oclif?: { exit?: number }; code?: string; message?: string };
}> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await Context.run(flags, { root: ROOT });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

function errorOf(outcome: ContextOutcome): {
  code: string;
  message: string;
} {
  return (JSON.parse(outcome.stderr) as { error: { code: string; message: string } })
    .error;
}

beforeEach(() => {
  cwd.mockReturnValue(ACME_DIR);
  delete process.env.GITHUB_TOKEN;
  delete process.env.FSCRT_ORG;
  useConfig('absent.yaml');
  FakeExecFileSync.mockReset();
  MockLatestCliVersion.mockClear();
});

afterEach(() => {
  process.exitCode = 0;
  env.restore();
});

// `process` outlives the suite, so put the real cwd back for the next file.
afterAll(() => {
  cwd.mockRestore();
});

describe('fs-forge context', () => {
  it('prints the context resolved from the config path match as JSON', async () => {
    useConfig('full.yaml');
    ghPrints(GH_TOKEN);

    const outcome = await run('--json');

    expect(JSON.parse(outcome.stdout)).toEqual({
      org: 'acme',
      source: 'config',
      matchedPath: ACME_DIR,
      repos: {
        claims: 'acme/claims-fork',
        stateGithub: 'acme/state-github-fork',
        stateInfra: 'acme/state-infra-fork',
        catalog: 'acme/catalog-fork',
      },
      cli: { version: CLI_VERSION, latest: '9.9.9', pinned: '2.0.1' },
      auth: { source: 'gh' },
    });
    expect(outcome.stdout + outcome.stderr).not.toContain(GH_TOKEN);
  });

  it('prints the effective context for humans', async () => {
    useConfig('full.yaml');
    ghPrints(GH_TOKEN);

    const outcome = await run();

    expect(outcome.stdout).toContain(`org: acme (config: ${ACME_DIR})`);
    expect(outcome.stdout).toContain('claims: acme/claims-fork');
    expect(outcome.stdout).toContain('state-github: acme/state-github-fork');
    expect(outcome.stdout).toContain('state-infra: acme/state-infra-fork');
    expect(outcome.stdout).toContain('catalog: acme/catalog-fork');
    expect(outcome.stdout).toContain(`cli: ${CLI_VERSION}`);
    expect(outcome.stdout).toContain('auth: gh');
    expect(outcome.stdout + outcome.stderr).not.toContain(GH_TOKEN);
  });

  it('prefers --org over FSCRT_ORG, and FSCRT_ORG over the config match', async () => {
    useConfig('full.yaml');
    ghPrints(GH_TOKEN);
    process.env.FSCRT_ORG = 'env-org';

    const flagged = await run('--json', '--org', 'flagged-org');
    expect(JSON.parse(flagged.stdout)).toEqual(
      expect.objectContaining({
        org: 'flagged-org',
        source: 'flag',
        matchedPath: null,
        repos: expect.objectContaining({ claims: 'flagged-org/claims' }),
        cli: expect.objectContaining({ pinned: '2.0.1' }),
      }),
    );

    const fromEnv = await run('--json');
    expect(JSON.parse(fromEnv.stdout)).toEqual(
      expect.objectContaining({ org: 'env-org', source: 'env' }),
    );
  });

  it('reports GITHUB_TOKEN as the auth source when it is set', async () => {
    useConfig('full.yaml');
    process.env.GITHUB_TOKEN = 'env-token';

    const outcome = await run('--json');

    expect(JSON.parse(outcome.stdout).auth).toEqual({
      source: 'GITHUB_TOKEN',
    });
    expect(FakeExecFileSync).not.toHaveBeenCalled();
  });

  it('exits non-zero with a stable code and JSON error shape', async () => {
    const noConfig = await run('--json');
    expect(errorOf(noConfig).code).toBe('NO_CONFIG');
    expect(noConfig.stdout).toBe('');
    expect(noConfig.error?.oclif?.exit).toBe(1);

    useConfig('defaults.yaml');
    cwd.mockReturnValue('/elsewhere/project');
    const noMatch = await run('--json');
    expect(errorOf(noMatch).code).toBe('NO_MATCH');

    useConfig('ambiguous.yaml');
    cwd.mockReturnValue('/srv/acme/project');
    const ambiguous = await run('--json');
    expect(errorOf(ambiguous).code).toBe('AMBIGUOUS_MATCH');

    useConfig('full.yaml');
    cwd.mockReturnValue(ACME_DIR);
    FakeExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('Command failed'), { status: 1 });
    });
    const noAuth = await run('--json');
    expect(errorOf(noAuth).code).toBe('NO_AUTH');
    expect(noAuth.error?.oclif?.exit).toBe(1);
  });

  it('reports the context code in the human error too', async () => {
    const outcome = await run();

    expect(outcome.error?.message).toContain('no usable fs-forge config');
    expect(outcome.error?.code).toBe('NO_CONFIG');
    expect(outcome.error?.oclif?.exit).toBe(1);
  });

  it('still reports the context when the registry lookup is unavailable', async () => {
    useConfig('full.yaml');
    ghPrints(GH_TOKEN);
    MockLatestCliVersion.mockResolvedValueOnce(null);

    const outcome = await run('--json');

    expect(JSON.parse(outcome.stdout)).toEqual(
      expect.objectContaining({ cli: expect.objectContaining({ latest: null }) }),
    );
    expect(outcome.result).toBe(0);
  });
});
