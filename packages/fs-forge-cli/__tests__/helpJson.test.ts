import { describe, expect, it } from '@jest/globals';
import { Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';

import CreateComponent from '../src/commands/create/component';
import CustomHelp from '../src/help';
import { setSchemasDir, validateClaim } from '../src/utils/ajvValidation';

const ROOT = process.cwd();

async function showComponentHelp(): Promise<string> {
  const config = await Config.load({ root: ROOT });
  const command = config.findCommand('create:component', { must: true });
  command.flags = CreateComponent.flags;
  command.load = async () => CreateComponent;
  const { stdout } = await captureOutput(() =>
    new CustomHelp(config).showHelp([
      'create',
      'component',
      '--help',
      '--json',
    ]),
  );
  return stdout;
}

describe('command help JSON contract', () => {
  it('documents the actual create command help output and its content', async () => {
    const help = JSON.parse(await showComponentHelp()) as {
      description: string;
      summary: string;
      flags: Array<{
        path: string;
        description?: string;
        multiple?: boolean;
      }>;
    };

    setSchemasDir(join(ROOT, 'schemas'));
    const validation = await validateClaim(help, 'CommandHelpJson');
    expect(validation).toEqual({ valid: true, errors: [] });

    expect(help.description).toBe('Create a new ComponentClaim.');
    const componentSchema = JSON.parse(
      readFileSync(join(ROOT, 'schemas', 'ComponentClaim.json'), 'utf8'),
    ) as { 'x-fs-forge-summary': string };
    expect(help.summary).toBe(componentSchema['x-fs-forge-summary']);

    const githubOrg = help.flags.find(
      (flag) => flag.path === 'providers.github.org',
    );
    expect(githubOrg?.description).toContain('--org');

    const repeatable = help.flags.find((flag) => flag.multiple);
    expect(repeatable?.description).toContain('replaces');
    expect(repeatable?.description).toContain('not appended');

    const commit = help.flags.find((flag) => flag.path === 'commit');
    expect(commit?.description).toContain('open a PR');
    expect(commit?.description).toContain('verification');
    expect(commit?.description).toContain('hydration');
    expect(commit?.description).toContain('second PR');

    const waitForChecks = help.flags.find(
      (flag) => flag.path === 'wait-for-checks',
    );
    expect(waitForChecks?.description).toContain('check runs');

    const stateRepos = help.flags.find((flag) => flag.path === 'state-repos');
    expect(stateRepos?.description).toContain('state repos');
  });
});
