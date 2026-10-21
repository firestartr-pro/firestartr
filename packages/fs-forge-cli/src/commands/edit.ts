import { Args, Command, Flags } from '@oclif/core';

import { claimsRepo } from '../claims/claimsRepo.js';
import { parseStateRepos } from '../claims/wetPr.js';
import { createGitHubApi } from '../github/index.js';
import { resolveClaimsRepository } from '../context/resolve.js';
import { resolveClaimReference } from '../claims/kindRegistry.js';
import {
  assertMutationFlags,
  mutationFlagsWithout,
} from '../mutations/definitions.js';
import { MUTATION_CONTROL_FLAGS, requireOrg } from '../mutations/support.js';
import {
  mutateFeatureReference,
  parseFeatureReference,
} from '../utils/features.js';
import { runClaimMutation } from '../mutations/orchestrator.js';

export default class Edit extends Command {
  static args = {
    reference: Args.string({
      description: 'Claim reference in <Kind>-<name> format',
      required: true,
    }),
  };

  static description =
    'Edit an existing claim. Network access requires GITHUB_TOKEN authentication.';

  static examples = [
    '<%= config.bin %> <%= command.id %> ComponentClaim-api --owner group:platform --org my-org',
    '<%= config.bin %> <%= command.id %> ComponentClaim-api --owner group:platform --org my-org --diff',
  ];

  static flags = {
    ...mutationFlagsWithout('kind', 'name', 'feature'),
    ...MUTATION_CONTROL_FLAGS,
    'add-feature': Flags.string({
      description: 'Attach name@version:{...} or name#ref:{...}',
      multiple: true,
    }),
    'remove-feature': Flags.string({
      description: 'Remove a Feature by name',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Edit);
    const reference = resolveClaimReference(args.reference);
    if (!reference) {
      this.error(`Invalid claim reference: ${args.reference}`);
    }
    const { kind, name } = reference;
    assertMutationFlags(kind, flags as Record<string, unknown>);
    if (
      (flags['add-feature']?.length || flags['remove-feature']?.length) &&
      kind !== 'ComponentClaim'
    ) {
      this.error('Feature references are only supported on ComponentClaim');
    }

    const org = requireOrg(flags.org);
    const target = resolveClaimsRepository(org);
    const repo = claimsRepo(createGitHubApi(), target.owner, target.repo);
    await runClaimMutation({
      repo,
      root: this.config.root,
      kind,
      sourceName: name,
      flags: flags as Record<string, unknown>,
      unset: flags.unset,
      commit: flags.commit,
      noWait: flags['no-wait'],
      waitForChecks: flags['wait-for-checks'],
      stateRepos: parseStateRepos(flags['state-repos'], org).join(','),
      transform: (claim) => {
        for (const value of flags['add-feature'] ?? []) {
          claim = mutateFeatureReference(
            claim,
            'add',
            parseFeatureReference(value),
          );
        }
        for (const featureName of flags['remove-feature'] ?? []) {
          claim = mutateFeatureReference(claim, 'remove', {
            name: featureName,
          });
        }
        return claim;
      },
      presentation: {
        diff: flags.diff,
        showDefaults: flags['show-defaults'],
        json: flags.json,
      },
    });
  }
}
