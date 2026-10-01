import { Command, Flags } from '@oclif/core';

import { loadClaimsArchive } from '../../claims/archive.js';
import { ClaimsClient } from '../../claims/client.js';
import {
  CLAIM_KIND_OPTIONS,
  normalizeClaimKind,
} from '../../mutations/definitions.js';
import {
  buildRelationGraph,
  filterRelationGraph,
  renderRelationGraph,
} from '../../lib/relationMap.js';
import { requireOrg } from '../../mutations/support.js';

export default class DiscoveryMap extends Command {
  static description = 'Show the relation tree for every claim in an org';

  static examples = [
    '<%= config.bin %> <%= command.id %> --org my-org',
    '<%= config.bin %> <%= command.id %> --org my-org --kind group --kind component --ascii',
    '<%= config.bin %> <%= command.id %> --org my-org --json',
  ];

  static flags = {
    org: Flags.string({
      description: 'GitHub organization containing the claims repo',
      env: 'FSCRT_ORG',
    }),
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
    const claims = await loadClaimsArchive(new ClaimsClient(org), flags.ref);
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
