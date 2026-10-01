import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

jest.mock('../src/claims/client', () => ({
  ClaimsClient: jest.fn(),
}));

import { ClaimsClient } from '../src/claims/client';
import CreateComponent from '../src/commands/create/component';
import CreateGroup from '../src/commands/create/group';
import CreateTfworkspace from '../src/commands/create/tfworkspace';
import Edit from '../src/commands/edit';
import { setSchemasDir, validateClaim } from '../src/utils/ajvValidation';

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

const MockClaimsClient = ClaimsClient as unknown as jest.Mock;

const MATCHING_WET_PR = {
  number: 42,
  html_url: 'https://github.com/my-org/custom-state/pull/42',
  state: 'open',
  head: { ref: 'automated-component-my-component' },
  base: { ref: 'main', sha: 'base-sha' },
  updated_at: '2026-01-01T00:00:00Z',
};

const SUCCESS_CHECK_RUN = {
  name: 'plan',
  conclusion: 'success',
  status: 'completed',
  output: {
    title: null,
    summary: 'ComponentClaim/my-component: success',
    text: null,
  },
  html_url: 'https://github.com/my-org/custom-state/checks/1',
};

function mockMutationClient(defaultsYaml: string | null, files: string[] = []) {
  const client = {
    owner: 'my-org',
    getDefaultBranch: jest.fn(async () => 'main'),
    hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
    listCheckRuns: jest.fn(async () => [SUCCESS_CHECK_RUN]),
    listFilesInPr: jest.fn(async () => []),
    listPullRequests: jest.fn(async () => [MATCHING_WET_PR]),
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
    listFilesRecursive: jest.fn(async () => files),
    publishClaim: jest.fn(async () => ({
      url: 'https://example.test/workflow',
      correlationId: 'corr-1',
      workflowId: 'provision-claim.yaml',
      branch: 'fs-forge/ComponentClaim-example',
    })),
    waitForWorkflow: jest.fn(async () => ({
      runUrl: 'https://github.com/my-org/claims/actions/runs/1',
      runId: 1,
      conclusion: 'success',
    })),
  };
  MockClaimsClient.mockImplementation(() => client);
  return client;
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
  MockClaimsClient.mockClear();
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
    expect(MockClaimsClient).not.toHaveBeenCalled();
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
    expect(MockClaimsClient).not.toHaveBeenCalled();
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
    expect(MockClaimsClient).not.toHaveBeenCalled();
  });

  it('publishes a new claim and waits for provisioning', async () => {
    const client = mockMutationClient(null);
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--commit', '--org', 'my-org');

    const result = await run(CreateComponent, ...args);

    expect(result.result).toBe(0);
    expect(result.stdout).toContain('kind: ComponentClaim');
    expect(result.stderr).toContain('Provisioning...');
    expect(client.publishClaim).toHaveBeenCalledWith(
      'ComponentClaim',
      'example',
      'claims/components/example.yaml',
      expect.stringContaining('kind: ComponentClaim'),
    );
  });

  it('accepts FSCRT_ORG when committing a created claim', async () => {
    process.env.FSCRT_ORG = 'env-org';
    mockMutationClient(null);
    const args = CreateComponent.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--commit');

    const result = await run(CreateComponent, ...args);

    expect(result.result).toBe(0);
    expect(MockClaimsClient).toHaveBeenCalledWith('env-org');
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
    expect(MockClaimsClient).not.toHaveBeenCalled();
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
    const client = mockMutationClient(null);
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
    expect(client.listPullRequests).toHaveBeenCalledWith(
      'my-org',
      'custom-state',
      expect.objectContaining({ state: 'open' }),
    );
    expect(client.listCheckRuns).toHaveBeenCalledWith(
      'my-org',
      'custom-state',
      MATCHING_WET_PR.number,
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
    setSchemasDir(join(ROOT, 'schemas'));
    const validation = await validateClaim(mutationDiff, 'MutationDiff');
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
    const client = mockMutationClient(null);
    client.getRawFile = jest.fn(async () => {
      throw new Error('GitHub API exploded');
    });
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
