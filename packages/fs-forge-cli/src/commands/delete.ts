import { Args, Command, Flags } from '@oclif/core';

import { claimExists } from '../claims/claimsMap.js';
import {
  claimsRepo,
  dispatchUnprovision,
  loadClaimsMap,
} from '../claims/claimsRepo.js';
import { createGitHubApi } from '../github/index.js';
import {
  CLAIM_KIND_OPTIONS,
  normalizeClaimKind,
} from '../mutations/definitions.js';
import { requireOrg } from '../mutations/support.js';
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
    '<%= config.bin %> <%= command.id %> component my-svc --org my-org',
    '<%= config.bin %> <%= command.id %> component my-svc --org my-org --commit',
    '<%= config.bin %> <%= command.id %> tfworkspace my-tf --org my-org --no-include-variants --commit',
  ];

  static flags = {
    org: Flags.string({
      description: 'GitHub organization containing the claims repo',
      env: 'FSCRT_ORG',
    }),
    'include-variants': Flags.boolean({
      description: 'Also delete variant CRs (TFWorkspaceClaim only)',
      default: true,
      allowNo: true,
    }),
    'wait-for-checks': Flags.boolean({
      description:
        'Wait for PR Verify to pass before merging the claim PR (CR plan checks always wait)',
      default: false,
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

    const kind = normalizeClaimKind(args.kind);
    if (!kind) this.error(`Unsupported claim kind: ${args.kind}`);

    const name = args.name;

    if (!flags.commit) {
      const org = flags.org ?? process.env.FSCRT_ORG;
      if (!org) {
        this.error(
          '--org or FSCRT_ORG is required even in dry-run mode to validate the claim exists',
        );
      }
      const repo = claimsRepo(createGitHubApi(), org);
      const map = await loadClaimsMap(repo);
      if (!claimExists(map, kind, name)) {
        this.error(`Claim not found: ${kind}-${name}`);
      }
      process.stderr.write(
        'Dry run — would dispatch unprovision-claim.yaml with:\n' +
          `  claimType: ${kind}\n` +
          `  claimName: ${name}\n` +
          `  includeVariants: ${flags['include-variants']}\n` +
          `  waitForClaimChecks: ${flags['wait-for-checks']}\n`,
      );
      return;
    }

    const org = requireOrg(flags.org);
    const repo = claimsRepo(createGitHubApi(), org);

    const map = await loadClaimsMap(repo);
    if (!claimExists(map, kind, name)) {
      this.error(`Claim not found: ${kind}-${name}`);
    }

    const workflowUrl = await dispatchUnprovision(repo, {
      kind,
      name,
      includeVariants: flags['include-variants'],
      waitForClaimChecks: flags['wait-for-checks'],
    });

    try {
      await waitForDispatch(repo.api, repo.ref, workflowUrl, {
        noWait: flags['no-wait'],
        claimType: kind,
        claimName: name,
        label: 'Unprovisioning',
      });
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
