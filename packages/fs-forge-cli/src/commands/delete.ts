import { Args, Command, Flags } from '@oclif/core';

import { claimExists } from '../claims/claimsMap.js';
import {
  claimsRepo,
  dispatchUnprovision,
  loadClaimsMap,
} from '../claims/claimsRepo.js';
import { createGitHubApi } from '../github/index.js';
import { resolveClaimsRepository } from '../context/resolve.js';
import { CLAIM_KIND_OPTIONS, normalizeKind } from '../claims/kindRegistry.js';
import { ORG_FLAG, requireOrg } from '../mutations/support.js';
import { waitForDispatch } from '../utils/waitForDispatch.js';

export default class Delete extends Command {
  static args = {
    kind: Args.string({
      description: 'Claim kind (short ID; full *Claim names remain supported)',
      options: CLAIM_KIND_OPTIONS,
      required: true,
    }),
    name: Args.string({
      description: 'Claim name',
      required: true,
    }),
  };

  static description =
    'Delete (unprovision) an existing claim. Network access requires GITHUB_TOKEN authentication.';

  static examples = [
    '<%= config.bin %> <%= command.id %> component my-svc',
    '<%= config.bin %> <%= command.id %> component my-svc --org my-org',
    '<%= config.bin %> <%= command.id %> component my-svc --org my-org --commit',
    '<%= config.bin %> <%= command.id %> tfworkspace my-tf --org my-org --no-include-variants --commit',
  ];

  static flags = {
    org: ORG_FLAG,
    'include-variants': Flags.boolean({
      description: 'Also delete variant CRs (TFWorkspaceClaim only)',
      default: true,
      allowNo: true,
    }),
    'wait-for-checks': Flags.boolean({
      description:
        'Wait for PR Verify to pass before merging the claim PR (CR plan checks always wait; --no-wait-for-checks to skip)',
      default: true,
      allowNo: true,
    }),
    commit: Flags.boolean({
      description: 'Dispatch the unprovision workflow',
    }),
    'no-wait': Flags.boolean({
      description: 'Skip waiting for the unprovision workflow to complete',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Delete);

    const kind = normalizeKind(args.kind);
    if (!kind) this.error(`Unsupported claim kind: ${args.kind}`);

    const org = requireOrg(
      flags.org,
      flags.commit
        ? undefined
        : '--org or FSCRT_ORG is required even in dry-run mode to validate the claim exists',
    );
    const target = resolveClaimsRepository(org);
    const repo = claimsRepo(createGitHubApi(), target.owner, target.repo);
    const map = await loadClaimsMap(repo);
    if (!claimExists(map, kind, args.name)) {
      this.error(`Claim not found: ${kind}-${args.name}`);
    }

    if (!flags.commit) {
      process.stderr.write(
        'Dry run — would dispatch unprovision-claim.yaml with:\n' +
          `  claimType: ${kind}\n` +
          `  claimName: ${args.name}\n` +
          `  includeVariants: ${flags['include-variants']}\n` +
          `  waitForClaimChecks: ${flags['wait-for-checks']}\n`,
      );
      return;
    }

    const workflowUrl = await dispatchUnprovision(repo, {
      kind,
      name: args.name,
      includeVariants: flags['include-variants'],
      waitForClaimChecks: flags['wait-for-checks'],
    });

    try {
      await waitForDispatch(repo.api, repo.ref, workflowUrl, {
        noWait: flags['no-wait'],
        claimType: kind,
        claimName: args.name,
        label: 'Unprovisioning',
      });
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
