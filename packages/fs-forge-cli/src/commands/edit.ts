import { Args, Command, Flags } from '@oclif/core';

import { claimsRepo } from '../claims/claimsRepo.js';
import { createGitHubApi } from '../github/index.js';
import {
  assertMutationFlags,
  isClaimKind,
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
    const separator = args.reference.indexOf('-');
    const kind = args.reference.slice(0, separator);
    const name = args.reference.slice(separator + 1);
    if (separator < 1 || !name || !isClaimKind(kind)) {
      this.error(`Invalid claim reference: ${args.reference}`);
    }
    assertMutationFlags(kind, flags as Record<string, unknown>);
    if (
      (flags['add-feature']?.length || flags['remove-feature']?.length) &&
      kind !== 'ComponentClaim'
    ) {
      this.error('Feature references are only supported on ComponentClaim');
    }

    const org = requireOrg(flags.org);
    const repo = claimsRepo(createGitHubApi(), org);
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
      stateRepos: flags['state-repos'],
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
