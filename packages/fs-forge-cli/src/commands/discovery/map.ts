import { Command, Flags } from '@oclif/core';

import { loadClaimsArchive } from '../../claims/archive.js';
import { createGitHubApi } from '../../github/index.js';
import {
  CLAIM_KIND_OPTIONS,
  normalizeClaimKind,
} from '../../mutations/definitions.js';
import {
  buildRelationGraph,
  filterRelationGraph,
  renderRelationGraph,
} from '../../lib/relationMap.js';
import { ORG_FLAG, requireOrg } from '../../mutations/support.js';

export default class DiscoveryMap extends Command {
  static description = 'Show the relation tree for every claim in an org';

  static examples = [
    '<%= config.bin %> <%= command.id %> --org my-org',
    '<%= config.bin %> <%= command.id %> --org my-org --kind group --kind component --ascii',
    '<%= config.bin %> <%= command.id %> --org my-org --json',
  ];

  static flags = {
    org: ORG_FLAG,
    ref: Flags.string({ description: 'Claims repo branch, tag, or commit' }),
    kind: Flags.string({
      description: 'Only show this claim kind by short ID (repeatable)',
      multiple: true,
      options: CLAIM_KIND_OPTIONS,
    }),
    ascii: Flags.boolean({ description: 'Use ASCII claim icons' }),
    json: Flags.boolean({ description: 'Output the relation graph as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DiscoveryMap);
    const org = requireOrg(flags.org);
    const kinds = flags.kind?.map((value) => normalizeClaimKind(value)!);
    const claims = await loadClaimsArchive(
      createGitHubApi(),
      { owner: org, repo: 'claims' },
      flags.ref,
    );
    const graph = buildRelationGraph(claims, org);
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(filterRelationGraph(graph, kinds), null, 2)}\n`,
      );
      return;
    }
    for (const line of renderRelationGraph(graph, {
      ascii: flags.ascii,
      kinds,
    })) {
      process.stdout.write(`${line}\n`);
    }
  }
}
