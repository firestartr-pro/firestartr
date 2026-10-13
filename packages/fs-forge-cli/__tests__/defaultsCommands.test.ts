import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { join } from 'path';
import YAML from 'yaml';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import DefaultsApply from '../src/commands/defaults/apply';
import DefaultsShow from '../src/commands/defaults/show';
import DefaultsList from '../src/commands/defaults/list';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

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

const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

function mockApi(
  options: {
    defaultsYaml?: string;
    blobPaths?: string[];
    repoFiles?: boolean;
  } = {},
) {
  const api = new MemoryGitHubApi();
  const ref = { owner: 'my-org', repo: 'claims' };
  api.setDefaultBranch(ref, 'main');
  if (options.defaultsYaml) {
    api.setFile(ref, 'claims/claims_defaults.yaml', options.defaultsYaml);
  }
  if (options.blobPaths) {
    api.setBlobPaths(ref, options.blobPaths);
  }
  if (options.repoFiles !== false) {
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify({
        headers: { sha: 'map-sha' },
        claims: {
          'ComponentClaim-my-component': {
            filePath: 'components/my-component.yaml',
          },
        },
      }),
      'map-file-sha',
    );
    api.setFile(
      ref,
      'claims/components/my-component.yaml',
      CLAIM_YAML,
      'claim-sha',
    );
  }
  MockCreateGitHubApi.mockReturnValue(api);
  return api;
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
  MockCreateGitHubApi.mockReset();
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
    mockApi({ defaultsYaml: DEFAULTS_YAML });
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
    mockApi({ defaultsYaml: DEFAULTS_YAML });
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
    mockApi();
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
    mockApi({ defaultsYaml: 'GroupClaim:\n  privacy: closed\n' });
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
    mockApi();
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
    mockApi({
      blobPaths: ['a/claims_defaults.yaml', 'b/claims_defaults.yaml'],
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
    mockApi({ defaultsYaml: DEFAULTS_YAML });
    const { result, stdout } = await run(DefaultsShow, 'component', '--org', 'my-org');

    expect(result).toBe(0);
    expect(YAML.parse(stdout)).toEqual({
      platformOwner: 'group:firestartr-test-platform-team',
      providers: { github: { technology: { stack: 'node', version: '14' } } },
    });
  });

  it('prints {} when the kind has no defaults', async () => {
    mockApi({ defaultsYaml: 'GroupClaim:\n  privacy: closed\n' });
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
    mockApi({
      defaultsYaml: [
        'GroupClaim:',
        '  privacy: closed',
        'ComponentClaim:',
        '  platformOwner: group:default',
        '',
      ].join('\n'),
    });
    const { result, stdout } = await run(DefaultsList, '--org', 'my-org');

    expect(result).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^KIND/);
    expect(lines[1]).toContain('ComponentClaim');
    expect(lines[2]).toContain('GroupClaim');
  });

  it('prints JSON with org and kinds', async () => {
    mockApi({ defaultsYaml: 'GroupClaim:\n  privacy: closed\n' });
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
    mockApi();
    const { result, stdout } = await run(DefaultsList, '--org', 'my-org');

    expect(result).toBe(0);
    expect(stdout).toBe('');
  });

  it('requires --org', async () => {
    const { error } = await run(DefaultsList);

    expect(error?.message).toContain('--org or FSCRT_ORG is required');
  });
});
