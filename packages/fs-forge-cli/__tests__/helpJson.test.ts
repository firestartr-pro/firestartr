import { describe, expect, it } from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';

import CreateComponent from '../src/commands/create/component';
import Delete from '../src/commands/delete';
import FeaturesAdd from '../src/commands/features/add';
import CustomHelp from '../src/help';
import { createClaimValidator } from '../src/utils/ajvValidation';

const ROOT = process.cwd();

interface HelpJson {
  description: string;
  summary: string;
  flags: Array<{
    path: string;
    description?: string;
    multiple?: boolean;
    default?: unknown;
  }>;
}

/** Renders `--help --json` for a command through the real help class. */
async function showJsonHelp(
  id: string,
  argv: string[],
  commandClass: Command.Class,
): Promise<HelpJson> {
  const config = await Config.load({ root: ROOT });
  const command = config.findCommand(id, { must: true });
  command.load = async () => commandClass;
  const { stdout } = await captureOutput(() =>
    new CustomHelp(config).showHelp([...argv, '--help', '--json']),
  );
  return JSON.parse(stdout) as HelpJson;
}

async function expectValidHelpJson(help: HelpJson): Promise<void> {
  const validator = createClaimValidator({ schemasDir: join(ROOT, 'schemas') });
  const result = await validator.validate(
    help as unknown as Record<string, unknown>,
    'CommandHelpJson',
  );
  expect(result).toEqual({ valid: true, errors: [] });
}

function findFlag(help: HelpJson, path: string) {
  return help.flags.find((flag) => flag.path === path);
}

describe('command help JSON contract', () => {
  it('documents the actual create command help output and its content', async () => {
    const help = await showJsonHelp(
      'create:component',
      ['create', 'component'],
      CreateComponent,
    );
    await expectValidHelpJson(help);

    expect(help.description).toBe('Create a new ComponentClaim.');
    const componentSchema = JSON.parse(
      readFileSync(join(ROOT, 'schemas', 'ComponentClaim.json'), 'utf8'),
    ) as { 'x-fs-forge-summary': string };
    expect(help.summary).toBe(componentSchema['x-fs-forge-summary']);

    const githubOrg = findFlag(help, 'providers.github.org');
    expect(githubOrg?.description).toContain('--org');

    const repeatable = help.flags.find((flag) => flag.multiple);
    expect(repeatable?.description).toContain('replaces');
    expect(repeatable?.description).toContain('not appended');

    const commit = findFlag(help, 'commit');
    expect(commit?.description).toContain('open a PR');
    expect(commit?.description).toContain('verification');
    expect(commit?.description).toContain('hydration');
    expect(commit?.description).toContain('second PR');

    const waitForChecks = findFlag(help, 'wait-for-checks');
    expect(waitForChecks?.description).toContain('check runs');
    expect(waitForChecks?.default).toBe(true);

    const stateRepos = findFlag(help, 'state-repos');
    expect(stateRepos?.description).toContain('state repos');
  });

  it('reports boolean defaults that the manifest omits', async () => {
    const help = await showJsonHelp('delete', ['delete'], Delete);

    expect(findFlag(help, 'wait-for-checks')?.default).toBe(true);
  });

  it('reports wait-for-checks default true for the Feature mutations', async () => {
    const help = await showJsonHelp(
      'features:add',
      ['features', 'add'],
      FeaturesAdd,
    );
    await expectValidHelpJson(help);

    const waitForChecks = findFlag(help, 'wait-for-checks');
    expect(waitForChecks?.description).toContain('check runs');
    expect(waitForChecks?.default).toBe(true);
    expect(findFlag(help, 'state-repos')?.description).toContain('state repos');
  });
});
