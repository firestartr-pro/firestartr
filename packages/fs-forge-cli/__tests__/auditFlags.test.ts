import { describe, expect, it } from '@jest/globals';
import { Command } from '@oclif/core';

import CreateArgodeploy from '../src/commands/create/argodeploy';
import CreateComponent from '../src/commands/create/component';
import CreateDomain from '../src/commands/create/domain';
import CreateGroup from '../src/commands/create/group';
import CreateOrgsettings from '../src/commands/create/orgsettings';
import CreateOrgwebhook from '../src/commands/create/orgwebhook';
import CreateSecrets from '../src/commands/create/secrets';
import CreateSystem from '../src/commands/create/system';
import CreateTfworkspace from '../src/commands/create/tfworkspace';
import CreateUser from '../src/commands/create/user';
import Delete from '../src/commands/delete';
import Edit from '../src/commands/edit';
import FeaturesAdd from '../src/commands/features/add';
import FeaturesEdit from '../src/commands/features/edit';
import FeaturesRemove from '../src/commands/features/remove';

interface FlagMeta {
  dependsOn?: string[];
  exclusive?: string[];
  description?: string;
}

type CommandClass = typeof Command;

/** Every command that can carry `--commit`, by command id. */
const COMMANDS: Array<[string, CommandClass]> = [
  ['create:argodeploy', CreateArgodeploy],
  ['create:component', CreateComponent],
  ['create:domain', CreateDomain],
  ['create:group', CreateGroup],
  ['create:orgsettings', CreateOrgsettings],
  ['create:orgwebhook', CreateOrgwebhook],
  ['create:secrets', CreateSecrets],
  ['create:system', CreateSystem],
  ['create:tfworkspace', CreateTfworkspace],
  ['create:user', CreateUser],
  ['edit', Edit],
  ['delete', Delete],
  ['features:add', FeaturesAdd],
  ['features:edit', FeaturesEdit],
  ['features:remove', FeaturesRemove],
];

/** Every command that exposes `--commit`, with its parsed flag table. */
function commitCommands(): Map<string, Record<string, FlagMeta>> {
  const found = new Map<string, Record<string, FlagMeta>>();
  for (const [id, command] of COMMANDS) {
    const flags = command.flags as Record<string, FlagMeta>;
    if ('commit' in flags) found.set(id, flags);
  }
  return found;
}

describe('audit-trail flags', () => {
  it('carries the audit flags on every --commit command, tied to --commit and to each other', () => {
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
      expect({
        id,
        flags: Object.keys(flags).sort(),
        issue: flags.issue.dependsOn,
        createIssue: flags['create-issue'].dependsOn,
        exclusive: flags.issue.exclusive,
        title: flags['issue-title'].dependsOn,
        body: flags['issue-body'].dependsOn,
      }).toEqual({
        id,
        flags: expect.arrayContaining([
          'commit',
          'create-issue',
          'issue',
          'issue-body',
          'issue-title',
        ]),
        issue: ['commit'],
        createIssue: ['commit'],
        exclusive: ['create-issue'],
        title: ['create-issue'],
        body: ['create-issue'],
      });
    }
  });

});
