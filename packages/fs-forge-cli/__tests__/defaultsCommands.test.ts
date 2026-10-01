import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { join } from 'path';
import YAML from 'yaml';

jest.mock('../src/claims/client', () => ({
  ClaimsClient: jest.fn(),
}));

import { ClaimsClient } from '../src/claims/client';
import DefaultsApply from '../src/commands/defaults/apply';
import DefaultsShow from '../src/commands/defaults/show';
import DefaultsList from '../src/commands/defaults/list';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;
const CLAIM_FILE = join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml');
const NO_KIND_FILE = join(ROOT, '__tests__', 'fixtures', 'invalid', 'no-kind.yaml');

const DEFAULTS_YAML = [
  'ComponentClaim:',
  '  platformOwner: group:firestartr-test-platform-team',
  '  providers:',
  '    github:',
  '      technology:',
  '        stack: node',
  '        version: "14"',
  '',
].join('\n');

const CLAIM_YAML = 'name: my-component\nkind: ComponentClaim\nowner: group:my-team\n';

const MockClaimsClient = ClaimsClient as unknown as jest.Mock;

function mockClient(overrides: Record<string, unknown> = {}) {
  const client = {
    getDefaultBranch: jest.fn(async () => 'main'),
    hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
    getFile: jest.fn(async () => null),
    getRawFile: jest.fn(async () => null),
    listFilesRecursive: jest.fn(async () => []),
    ...overrides,
  };
  MockClaimsClient.mockImplementation(() => client);
  return client;
}

function mockRepoClient(defaultsYaml: string | null) {
  return mockClient({
    getFile: jest.fn(async (path: string) => {
      if (path === 'claims-map.json') {
        return {
          content: JSON.stringify({
            headers: { sha: 'map-sha' },
            claims: {
              'ComponentClaim-my-component': {
                filePath: 'components/my-component.yaml',
              },
            },
          }),
          path,
          sha: 'map-file-sha',
        };
      }
      if (path === 'claims/components/my-component.yaml') {
        return { content: CLAIM_YAML, path, sha: 'claim-sha' };
      }
      return null;
    }),
    getRawFile: jest.fn(async (path: string) =>
      path === 'claims/claims_defaults.yaml' ? defaultsYaml : null,
    ),
  });
}

type CommandClass = typeof Command &
  (new (argv: string[], config: Config) => Command);

async function run(command: CommandClass, ...flags: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await command.run(flags, { root: ROOT });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

beforeEach(() => {
  delete process.env.FSCRT_ORG;
  MockClaimsClient.mockReset();
});

afterEach(() => {
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

describe('defaults apply', () => {
  it('fetches a claim by reference and outputs the defaults-filled YAML', async () => {
    mockRepoClient(DEFAULTS_YAML);
    const { result, stdout } = await run(
      DefaultsApply,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
    );

    expect(result).toBe(0);
    expect(YAML.parse(stdout)).toMatchObject({
      kind: 'ComponentClaim',
      name: 'my-component',
      platformOwner: 'group:firestartr-test-platform-team',
      providers: {
        github: { technology: { stack: 'node', version: '14' } },
      },
    });
  });

  it('applies defaults to a local file with -f', async () => {
    mockClient({
      getRawFile: jest.fn(async (path: string) =>
        path === 'claims/claims_defaults.yaml' ? DEFAULTS_YAML : null,
      ),
    });
    const { result, stdout } = await run(
      DefaultsApply,
      '-f',
      CLAIM_FILE,
      '--org',
      'my-org',
    );

    expect(result).toBe(0);
    const claim = YAML.parse(stdout);
    expect(claim.platformOwner).toBe('group:firestartr-test-platform-team');
    expect(claim.providers.github.technology).toEqual({
      stack: 'node',
      version: '14',
    });
    // Values set by the user are never overwritten
    expect(claim.providers.github.visibility).toBe('private');
  });

  it('rejects a -f file without a kind field', async () => {
    mockClient();
    const { error } = await run(
      DefaultsApply,
      '-f',
      NO_KIND_FILE,
      '--org',
      'my-org',
    );

    expect(error?.message).toContain('"kind" field');
  });

  it('outputs the claim unchanged when its kind has no defaults', async () => {
    mockClient({
      getRawFile: jest.fn(async () => 'GroupClaim:\n  privacy: closed\n'),
    });
    const { result, stdout } = await run(
      DefaultsApply,
      '-f',
      CLAIM_FILE,
      '--org',
      'my-org',
    );

    expect(result).toBe(0);
    expect(YAML.parse(stdout).platformOwner).toBeUndefined();
  });

  it('outputs the claim unchanged when no defaults file exists', async () => {
    mockRepoClient(null);
    const { result, stdout } = await run(
      DefaultsApply,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
    );

    expect(result).toBe(0);
    expect(YAML.parse(stdout)).toEqual({
      name: 'my-component',
      kind: 'ComponentClaim',
      owner: 'group:my-team',
    });
  });

  it('fails hard when the defaults location is ambiguous', async () => {
    mockClient({
      listFilesRecursive: jest.fn(async () => [
        'a/claims_defaults.yaml',
        'b/claims_defaults.yaml',
      ]),
    });
    const { error } = await run(DefaultsApply, '-f', CLAIM_FILE, '--org', 'my-org');

    expect(error?.message).toContain(
      'Multiple claims_defaults.yaml files found: a/claims_defaults.yaml, b/claims_defaults.yaml',
    );
  });

  it('rejects an invalid claim reference', async () => {
    const { error } = await run(DefaultsApply, 'not-a-ref', '--org', 'my-org');

    expect(error?.message).toContain('Invalid claim reference');
  });

  it('requires either a reference or -f', async () => {
    const { error } = await run(DefaultsApply, '--org', 'my-org');

    expect(error?.message).toContain(
      'Provide a claim reference or -f <file>',
    );
  });

  it('requires --org', async () => {
    const { error } = await run(DefaultsApply, 'ComponentClaim-my-component');

    expect(error?.message).toContain('--org or FSCRT_ORG is required');
  });
});

describe('defaults show', () => {
  it('prints the defaults for a kind as YAML', async () => {
    mockClient({
      getRawFile: jest.fn(async (path: string) =>
        path === 'claims/claims_defaults.yaml' ? DEFAULTS_YAML : null,
      ),
    });
    const { result, stdout } = await run(DefaultsShow, 'component', '--org', 'my-org');

    expect(result).toBe(0);
    expect(YAML.parse(stdout)).toEqual({
      platformOwner: 'group:firestartr-test-platform-team',
      providers: { github: { technology: { stack: 'node', version: '14' } } },
    });
  });

  it('prints {} when the kind has no defaults', async () => {
    mockClient({
      getRawFile: jest.fn(async () => 'GroupClaim:\n  privacy: closed\n'),
    });
    const { result, stdout } = await run(DefaultsShow, 'component', '--org', 'my-org');

    expect(result).toBe(0);
    expect(stdout.trim()).toBe('{}');
  });

  it('rejects an unknown kind id and lists the valid ids', async () => {
    const { error } = await run(DefaultsShow, 'bogus', '--org', 'my-org');

    expect(error?.message).toContain('Unknown claim kind: bogus');
    expect(error?.message).toContain('component');
  });

  it('requires --org', async () => {
    const { error } = await run(DefaultsShow, 'component');

    expect(error?.message).toContain('--org or FSCRT_ORG is required');
  });
});

describe('defaults list', () => {
  it('prints a table of kinds with defaults', async () => {
    mockClient({
      getRawFile: jest.fn(async () =>
        [
          'GroupClaim:',
          '  privacy: closed',
          'ComponentClaim:',
          '  platformOwner: group:default',
          '',
        ].join('\n'),
      ),
    });
    const { result, stdout } = await run(DefaultsList, '--org', 'my-org');

    expect(result).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^KIND/);
    expect(lines[1]).toContain('ComponentClaim');
    expect(lines[2]).toContain('GroupClaim');
  });

  it('prints JSON with org and kinds', async () => {
    mockClient({
      getRawFile: jest.fn(async () => 'GroupClaim:\n  privacy: closed\n'),
    });
    const { result, stdout } = await run(
      DefaultsList,
      '--org',
      'my-org',
      '--json',
    );

    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ org: 'my-org', kinds: ['GroupClaim'] });
  });

  it('prints nothing when no defaults file exists', async () => {
    mockClient();
    const { result, stdout } = await run(DefaultsList, '--org', 'my-org');

    expect(result).toBe(0);
    expect(stdout).toBe('');
  });

  it('requires --org', async () => {
    const { error } = await run(DefaultsList);

    expect(error?.message).toContain('--org or FSCRT_ORG is required');
  });
});
