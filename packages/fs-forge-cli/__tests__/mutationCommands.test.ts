import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import CreateComponent from '../src/commands/create/component';
import CreateGroup from '../src/commands/create/group';
import CreateTfworkspace from '../src/commands/create/tfworkspace';
import Edit from '../src/commands/edit';
import { createClaimValidator } from '../src/utils/ajvValidation';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;

const CLAIM_YAML = readFileSync(
  join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml'),
  'utf8',
);
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

const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

function seedClaims(api: MemoryGitHubApi, ref: { owner: string; repo: string }) {
  api.setDefaultBranch(ref, 'main');
  api.setBranchHeadSha(ref, 'main', 'base-sha');
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

function mockMutationClient(defaultsYaml: string | null, files: string[] = []) {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  for (const owner of ['my-org', 'env-org']) {
    seedClaims(api, { owner, repo: 'claims' });
  }
  const ref = { owner: 'my-org', repo: 'claims' };
  if (defaultsYaml) {
    api.setFile(ref, 'claims/claims_defaults.yaml', defaultsYaml);
  }
  api.setBlobPaths(ref, files);

  const state = { owner: 'my-org', repo: 'custom-state' };
  api.setPullRequests(state, [
    {
      number: 42,
      htmlUrl: 'https://github.com/my-org/custom-state/pull/42',
      state: 'open',
      headRef: 'automated-component-my-component',
      baseSha: 'base-sha',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]);
  api.setCheckRuns(state, 42, [
    {
      name: 'plan',
      conclusion: 'success',
      status: 'completed',
      output: {
        title: null,
        summary: 'ComponentClaim/my-component: success',
        text: null,
      },
      htmlUrl: 'https://github.com/my-org/custom-state/checks/1',
    },
  ]);

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

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  MockCreateGitHubApi.mockClear();
  process.exitCode = 0;
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

describe('mutation command arguments', () => {
  it('rejects flags that do not apply to the selected kind', async () => {
    const edit = await captureOutput(() =>
      Edit.run(
        ['GroupClaim-platform', '--providers.github.visibility', 'private'],
        { root: process.cwd() },
      ),
    );
    expect(edit.error?.message).toContain(
      'Flags not supported for GroupClaim: --providers.github.visibility',
    );

    const editPath = await captureOutput(() =>
      Edit.run(
        ['ComponentClaim-api', '--path', 'claims/components/api.yaml'],
        { root: process.cwd() },
      ),
    );
    expect(editPath.error?.message).toContain('Nonexistent flag: --path');
  });

  it('rejects an invalid edit reference before making network calls', async () => {
    const result = await captureOutput(() =>
      Edit.run(['component-without-kind'], { root: process.cwd() }),
    );

    expect(result.error?.message).toContain('Invalid claim reference');
  });

  it('requires an org only when committing a created claim', async () => {
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--commit');

    const result = await captureOutput(() =>
      CreateComponent.run(args, { root: process.cwd() }),
    );

    expect(result.error?.message).toContain(
      '--org or FSCRT_ORG is required',
    );
    expect(MockCreateGitHubApi).not.toHaveBeenCalled();
  });

  it('requires a path when committing a created TFWorkspaceClaim', async () => {
    const args: string[] =
      CreateTfworkspace.examples[0]
        .replace('<%= config.bin %> <%= command.id %> ', '')
        .match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    args.push('--commit', '--org', 'my-org');

    const result = await captureOutput(() =>
      CreateTfworkspace.run(args, { root: process.cwd() }),
    );

    expect(result.error?.message).toContain(
      '--path is required when committing a TFWorkspaceClaim',
    );
    expect(MockCreateGitHubApi).not.toHaveBeenCalled();
  });

  it('rejects an explicit path for a deterministic-path created claim', async () => {
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--path', 'claims/components/example.yaml');

    const result = await captureOutput(() =>
      CreateComponent.run(args, { root: process.cwd() }),
    );

    expect(result.error?.message).toContain(
      '--path is only supported for TFWorkspaceClaim and SecretsClaim',
    );
    expect(MockCreateGitHubApi).not.toHaveBeenCalled();
  });

  it('publishes a new claim and waits for provisioning', async () => {
    const api = mockMutationClient(null);
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--commit', '--org', 'my-org');

    const result = await run(CreateComponent, ...args);

    expect(result.result).toBe(0);
    expect(result.stdout).toContain('kind: ComponentClaim');
    expect(result.stderr).toContain('Provisioning...');
    expect(api.committed[0]).toEqual({
      ref: { owner: 'my-org', repo: 'claims' },
      path: 'claims/components/example.yaml',
      branch: 'fs-forge/ComponentClaim-example',
      message: 'ComponentClaim-example: update claim',
      content: expect.stringContaining('kind: ComponentClaim'),
    });
    expect(api.dispatched[0].inputs).toEqual(
      expect.objectContaining({
        claimType: 'ComponentClaim',
        claimName: 'example',
      }),
    );
  });

  it('accepts FSCRT_ORG when committing a created claim', async () => {
    process.env.FSCRT_ORG = 'env-org';
    const api = mockMutationClient(null);
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--commit');

    const result = await run(CreateComponent, ...args);

    expect(result.result).toBe(0);
    expect(MockCreateGitHubApi).toHaveBeenCalledTimes(1);
    expect(api.calls).toContain(
      'readFile env-org/claims:claims-map.json@claims-index',
    );
  });

  it('does not publish a created claim that fails validation', async () => {
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    const owner = args.indexOf('group:platform');
    args[owner] = 'invalid-owner';
    args.push('--commit', '--org', 'my-org');

    const result = await captureOutput(() =>
      CreateComponent.run(args, { root: process.cwd() }),
    );

    expect(result.error).toBeDefined();
    expect(MockCreateGitHubApi).not.toHaveBeenCalled();
  });

  it('no longer accepts --diff on create commands', async () => {
    const args = CreateGroup.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--diff');

    const result = await captureOutput(() =>
      CreateGroup.run(args, { root: process.cwd() }),
    );

    expect(result.error?.message).toContain('Nonexistent flag: --diff');
  });
});

describe('clone command removal', () => {
  it('is absent from the oclif command config', async () => {
    const config = await Config.load({ root: ROOT });

    expect(config.findCommand('clone')).toBeUndefined();
  });

  it('is absent from the published manifest and its aliases', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'oclif.manifest.json'), 'utf8'),
    ) as { commands: Record<string, { aliases?: string[] }> };

    expect(manifest.commands).not.toHaveProperty('clone');
    for (const command of Object.values(manifest.commands)) {
      expect(command.aliases ?? []).not.toContain('clone');
    }
  });

  it('fails as an unknown command when invoked', async () => {
    const config = await Config.load({ root: ROOT });

    await expect(config.runCommand('clone', [])).rejects.toThrow(
      'command clone not found',
    );
  });
});

describe('edit --wait-for-checks forwarding', () => {
  it('watches the wet PR checks with the bare repository name', async () => {
    const api = mockMutationClient(null);
    const { result, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--commit',
      '--wait-for-checks',
      '--state-repos',
      'my-org/custom-state',
    );

    expect(result).toBe(0);
    expect(api.calls).toContain(
      'listOpenPullRequests my-org/custom-state:automated',
    );
    expect(api.calls).toContain(
      'listCheckRunsForPullRequest my-org/custom-state#42',
    );
    expect(stderr).toContain('Watching wet PR my-org/custom-state#42...');
    expect(stderr).toContain('All checks passed');
  });
});

describe('edit defaults integration', () => {
  it('applies defaults after overrides and hides them from the diff by default', async () => {
    mockMutationClient(DEFAULTS_YAML);
    const { result, stdout, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--diff',
      '--providers.github.visibility',
      'public',
    );

    expect(result).toBe(0);
    expect(YAML.parse(stdout)).toMatchObject({
      platformOwner: 'group:firestartr-test-platform-team',
      providers: {
        github: {
          visibility: 'public',
          technology: { stack: 'node', version: '14' },
        },
      },
    });
    expect(stderr).toContain('-     visibility: private');
    expect(stderr).toContain('+     visibility: public');
    expect(stderr).not.toContain('+ platformOwner:');
    expect(stderr).not.toContain('Defaults applied');
  });

  it('renders a Defaults applied section with --diff --show-defaults', async () => {
    mockMutationClient(DEFAULTS_YAML);
    const { result, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--diff',
      '--show-defaults',
      '--providers.github.visibility',
      'public',
    );

    expect(result).toBe(0);
    expect(stderr).toContain('+     visibility: public');
    expect(stderr).toContain('+ platformOwner: group:firestartr-test-platform-team');
  });

  it('--show-defaults implicitly enables diff output', async () => {
    mockMutationClient(DEFAULTS_YAML);
    const { result, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--show-defaults',
      '--providers.github.visibility',
      'public',
    );

    expect(result).toBe(0);
    expect(stderr).toContain('+     visibility: public');
    expect(stderr).toContain('+ platformOwner: group:firestartr-test-platform-team');
  });

  it('emits a {changes, defaults} wrapper in JSON mode with --show-defaults', async () => {
    mockMutationClient(DEFAULTS_YAML);
    const { result, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--json',
      '--show-defaults',
      '--providers.github.visibility',
      'public',
    );

    expect(result).toBe(0);
    const mutationDiff = JSON.parse(stderr);
    const validator = createClaimValidator({ schemasDir: join(ROOT, 'schemas') });
    const validation = await validator.validate(mutationDiff, 'MutationDiff');
    expect(validation).toEqual({ valid: true, errors: [] });
    expect(mutationDiff).toEqual({
      changes: [
        {
          path: 'providers.github.visibility',
          before: 'private',
          after: 'public',
        },
      ],
      defaults: {
        platformOwner: 'group:firestartr-test-platform-team',
        'providers.github.technology': { stack: 'node', version: '14' },
      },
    });
  });

  it('emits the flat field diff as JSON without --show-defaults', async () => {
    mockMutationClient(DEFAULTS_YAML);
    const { result, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--json',
      '--diff',
      '--providers.github.visibility',
      'public',
    );

    expect(result).toBe(0);
    expect(JSON.parse(stderr)).toEqual([
      {
        path: 'providers.github.visibility',
        before: 'private',
        after: 'public',
      },
    ]);
  });

  it('works unchanged when the repo has no defaults file', async () => {
    mockMutationClient(null);
    const { result, stdout, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--diff',
      '--providers.github.visibility',
      'public',
    );

    expect(result).toBe(0);
    expect(stderr).not.toContain('Defaults applied');
    expect(YAML.parse(stdout).platformOwner).toBeUndefined();
  });

  it('warns and continues without defaults when the location is ambiguous', async () => {
    mockMutationClient(null, [
      'a/claims_defaults.yaml',
      'b/claims_defaults.yaml',
    ]);
    const { result, stdout, stderr } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--providers.github.visibility',
      'public',
    );

    expect(result).toBe(0);
    expect(stderr).toContain('Skipping defaults');
    expect(stderr).toContain('a/claims_defaults.yaml');
    expect(YAML.parse(stdout).platformOwner).toBeUndefined();
  });

  it('fails hard when fetching defaults errors', async () => {
    const api = mockMutationClient(null);
    api.readFile = async () => {
      throw new Error('GitHub API exploded');
    };
    const { error } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--org',
      'my-org',
      '--providers.github.visibility',
      'public',
    );

    expect(error?.message).toContain('GitHub API exploded');
  });
});
