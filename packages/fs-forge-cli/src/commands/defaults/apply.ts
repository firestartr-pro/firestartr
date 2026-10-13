import { Args, Command, Flags } from '@oclif/core';
import { readFile } from 'fs/promises';

import {
  claimsRepo,
  loadClaimsMap,
  resolveClaim,
} from '../../claims/claimsRepo.js';
import { applyDefaultsFromRepo } from '../../claims/defaults.js';
import { createGitHubApi } from '../../github/index.js';
import { serializeClaim } from '../../claims/keyOrdering.js';
import { resolveClaimReference } from '../../claims/kindRegistry.js';
import {
  ORG_FLAG,
  parseClaimYaml,
  requireOrg,
} from '../../mutations/support.js';

function claimKind(claim: Record<string, unknown>): string {
  const kind = claim.kind;
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new Error('The claim must define a "kind" field to apply defaults');
  }
  return kind;
}

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class DefaultsApply extends Command {
  static description =
    'Apply claim defaults from the claims repo to a claim and print the filled YAML';

  static examples = [
    '<%= config.bin %> <%= command.id %> ComponentClaim-my-service --org my-org',
    '<%= config.bin %> <%= command.id %> -f /tmp/claim.yaml --org my-org',
  ];

  static args = {
    reference: Args.string({
      description: 'Claim reference in <Kind>-<name> format',
      required: false,
    }),
  };

  static flags = {
    org: ORG_FLAG,
    file: Flags.string({
      char: 'f',
      description: 'Path to a local claim YAML file',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DefaultsApply);
    const org = requireOrg(flags.org);
    if (!args.reference && !flags.file) {
      this.error('Provide a claim reference or -f <file>');
    }
    if (args.reference && flags.file) {
      this.error('Provide either a claim reference or -f <file>, not both');
    }

    const repo = claimsRepo(createGitHubApi(), org);

    let claim: Record<string, unknown>;
    if (flags.file) {
      claim = parseClaimYaml(await readFile(flags.file, 'utf8'));
    } else {
      const reference = args.reference as string;
      if (!resolveClaimReference(reference)) {
        this.error(`Invalid claim reference: ${reference}`);
      }
      const map = await loadClaimsMap(repo);
      const resolved = await resolveClaim(repo, map, reference);
      claim = parseClaimYaml(resolved.content);
    }

    claimKind(claim);
    const filled = await applyDefaultsFromRepo(repo, claim, 'strict');

    writeLine(serializeClaim(filled));
  }
}
