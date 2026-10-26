import { afterEach, describe, expect, it } from '@jest/globals';
import { Command } from '@oclif/core';
import { captureOutput } from '@oclif/test';

import { KIND_CAPABILITIES } from '../src/claims/kindRegistry';
import CreateComponent from '../src/commands/create/component';

const ROOT = process.cwd();

interface FlagMeta {
  dependsOn?: string[];
  exclusive?: string[];
  description?: string;
}

type CommandClass = typeof Command;

const MODULES: Array<[string, string]> = [
  ...KIND_CAPABILITIES.map(
    (capability) =>
      [`create:${capability.id}`, `../src/commands/create/${capability.id}`] as [
        string,
        string,
      ],
  ),
  ['edit', '../src/commands/edit'],
  ['delete', '../src/commands/delete'],
  ['features:add', '../src/commands/features/add'],
  ['features:edit', '../src/commands/features/edit'],
  ['features:remove', '../src/commands/features/remove'],
];

/** Every command that exposes `--commit`, with its parsed flag table. */
function commitCommands(): Map<string, Record<string, FlagMeta>> {
  const found = new Map<string, Record<string, FlagMeta>>();
  for (const [id, path] of MODULES) {
    const flags = (require(path) as { default: CommandClass }).default.flags as
      Record<string, FlagMeta>;
    if ('commit' in flags) found.set(id, flags);
  }
  return found;
}

function componentArgs(extra: string[]): string[] {
  const example = CreateComponent.examples[0].replace(
    '<%= config.bin %> <%= command.id %> ',
    '',
  );
  return [...example.split(' '), ...extra];
}

async function runComponent(extra: string[]) {
  return captureOutput(() =>
    CreateComponent.run(componentArgs(extra), { root: ROOT }),
  );
}

const ORIGINAL_ORG = process.env.FSCRT_ORG;

afterEach(() => {
  process.exitCode = 0;
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

describe('audit-trail flags', () => {
  it('reaches every --commit command', () => {
    const commands = commitCommands();

    expect([...commands.keys()]).toEqual(
      expect.arrayContaining([
        'create:component',
        'edit',
        'delete',
        'features:add',
        'features:edit',
        'features:remove',
      ]),
    );
    for (const [id, flags] of commands) {
      expect({ id, flags: Object.keys(flags).sort() }).toEqual({
        id,
        flags: expect.arrayContaining([
          'commit',
          'create-issue',
          'issue',
          'issue-body',
          'issue-title',
        ]),
      });
    }
  });

  it('ties the audit flags to --commit and to each other', () => {
    for (const [id, flags] of commitCommands()) {
      expect({ id, issue: flags.issue.dependsOn }).toEqual({
        id,
        issue: ['commit'],
      });
      expect({ id, createIssue: flags['create-issue'].dependsOn }).toEqual({
        id,
        createIssue: ['commit'],
      });
      expect({ id, issue: flags.issue.exclusive }).toEqual({
        id,
        issue: ['create-issue'],
      });
      expect({ id, title: flags['issue-title'].dependsOn }).toEqual({
        id,
        title: ['create-issue'],
      });
      expect({ id, body: flags['issue-body'].dependsOn }).toEqual({
        id,
        body: ['create-issue'],
      });
    }
  });

  it('refuses --issue without --commit', async () => {
    const result = await runComponent(['--issue', '7']);

    expect(result.error?.message).toContain(
      'All of the following must be provided when using --issue: --commit',
    );
  });

  it('refuses --issue together with --create-issue', async () => {
    const result = await runComponent([
      '--commit',
      '--issue',
      '7',
      '--create-issue',
    ]);

    expect(result.error?.message).toContain(
      'cannot also be provided when using --issue',
    );
  });

  it('refuses --issue-title without --create-issue', async () => {
    const result = await runComponent([
      '--commit',
      '--issue-title',
      'Ship it',
    ]);

    expect(result.error?.message).toContain(
      'All of the following must be provided when using --issue-title: --create-issue',
    );
  });
});
