import { Command, Flags } from '@oclif/core';

import { claimsRepo, loadClaimsMap } from '../../claims/claimsRepo.js';
import { createGitHubApi } from '../../github/index.js';
import {
  CLAIM_KIND_OPTIONS,
  normalizeClaimKind,
} from '../../mutations/definitions.js';
import { requireOrg } from '../../mutations/support.js';

interface ClaimEntry {
  kind: string;
  name: string;
  filePath: string;
}

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class DiscoveryOrgElements extends Command {
  static description = "List all claims in an org's claims repo";

  static examples = [
    '<%= config.bin %> <%= command.id %> --org my-org',
    '<%= config.bin %> <%= command.id %> --org my-org --kind component --kind group',
    '<%= config.bin %> <%= command.id %> --org my-org --json',
  ];

  static flags = {
    org: Flags.string({
      description: 'GitHub organization owning the claims repo',
      env: 'FSCRT_ORG',
    }),
    'claims-repo': Flags.string({
      description: 'Repository name for the claims repo',
      default: 'claims',
    }),
    kind: Flags.string({
      description: 'Filter to a claim kind by short ID (repeatable)',
      multiple: true,
      options: CLAIM_KIND_OPTIONS,
    }),
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DiscoveryOrgElements);
    const org = requireOrg(flags.org);

    const kindFilter = flags.kind?.map((value) => normalizeClaimKind(value)!);

    const repo = claimsRepo(createGitHubApi(), org, flags['claims-repo']);
    const map = await loadClaimsMap(repo);

    const entries: ClaimEntry[] = Object.entries(map.claims)
      .map(([reference, entry]) => {
        const separator = reference.indexOf('-');
        return {
          kind: reference.slice(0, separator),
          name: reference.slice(separator + 1),
          filePath: entry.filePath,
        };
      })
      .filter(
        (entry) =>
          !kindFilter || kindFilter.some((kind) => kind === entry.kind),
      )
      .sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
      );

    if (flags.json) {
      const claims: Record<string, { name: string; filePath: string }[]> = {};
      for (const entry of entries) {
        (claims[entry.kind] ??= []).push({
          name: entry.name,
          filePath: entry.filePath,
        });
      }
      writeLine(
        JSON.stringify(
          {
            org,
            claimsRepo: flags['claims-repo'],
            claimsMapSha: map.headers.sha,
            claims,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (entries.length === 0) return;

    const kindW = Math.max(...entries.map((e) => e.kind.length), 4);
    const nameW = Math.max(...entries.map((e) => e.name.length), 4);
    writeLine(
      'KIND'.padEnd(kindW) + '  ' + 'NAME'.padEnd(nameW) + '  FILE PATH',
    );
    for (const entry of entries) {
      writeLine(
        entry.kind.padEnd(kindW) +
          '  ' +
          entry.name.padEnd(nameW) +
          '  ' +
          entry.filePath,
      );
    }
  }
}
