import { Command, Flags } from '@oclif/core';

export const CLAIM_KINDS = [
  {
    id: 'argodeploy',
    kind: 'ArgoDeployClaim',
    description: 'Deploy an application to Argo CD from a claim.',
  },
  {
    id: 'component',
    kind: 'ComponentClaim',
    description:
      'Describe a software component and the repository that hosts it.',
  },
  {
    id: 'domain',
    kind: 'DomainClaim',
    description:
      'Describe a domain that groups related systems and components.',
  },
  {
    id: 'group',
    kind: 'GroupClaim',
    description: 'Manage a GitHub team and its membership.',
  },
  {
    id: 'orgsettings',
    kind: 'OrgSettingsClaim',
    description: 'Configure GitHub organization settings and variables.',
  },
  {
    id: 'orgwebhook',
    kind: 'OrgWebhookClaim',
    description: 'Configure a webhook for a GitHub organization.',
  },
  {
    id: 'secrets',
    kind: 'SecretsClaim',
    description: 'Manage external secrets for a platform resource.',
  },
  {
    id: 'system',
    kind: 'SystemClaim',
    description: 'Describe a system made up of related components.',
  },
  {
    id: 'tfworkspace',
    kind: 'TFWorkspaceClaim',
    description: 'Manage a Terraform workspace and its infrastructure state.',
  },
  {
    id: 'user',
    kind: 'UserClaim',
    description: "Manage a GitHub user's organization membership.",
  },
];

function writeLine(value: string): void {
  process.stdout.write(value + '\n');
}

export default class Kinds extends Command {
  static description = 'List supported claim kinds';

  static flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Kinds);

    if (flags.json) {
      writeLine(JSON.stringify(CLAIM_KINDS, null, 2));
    } else {
      const idW = Math.max(...CLAIM_KINDS.map((k) => k.id.length), 2);
      const kindW = Math.max(...CLAIM_KINDS.map((k) => k.kind.length), 4);
      writeLine(
        'ID'.padEnd(idW) + '  ' + 'KIND'.padEnd(kindW) + '  DESCRIPTION',
      );
      for (const kind of CLAIM_KINDS) {
        writeLine(
          `${kind.id.padEnd(idW)}  ${kind.kind.padEnd(kindW)}  ${kind.description}`,
        );
      }
    }
  }
}
