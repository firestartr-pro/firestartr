import { Args, Command, Flags } from '@oclif/core';

import { claimExists } from '../claims/claimsMap.js';
import {
  claimsRepo,
  dispatchUnprovision,
  loadClaimsMap,
} from '../claims/claimsRepo.js';
import { createGitHubApi } from '../github/index.js';
import { resolveClaimsRepository } from '../context/resolve.js';
import {
  CLAIM_KIND_OPTIONS,
  KIND_CAPABILITIES,
  normalizeKind,
} from '../claims/kindRegistry.js';
import { withAuditTrail } from '../mutations/auditIssue.js';
import {
  AUDIT_TRAIL_FLAGS,
  ORG_FLAG,
  auditTrailOptions,
  requireOrg,
} from '../mutations/support.js';
import { waitForDispatch } from '../utils/waitForDispatch.js';

const VARIANT_KIND_LABEL = KIND_CAPABILITIES.filter(({ variants }) => variants)
  .map(({ kind }) => kind)
  .join(', ');

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
    '<%= config.bin %> <%= command.id %> component my-svc --org my-org --commit --create-issue',
  ];

  static flags = {
    org: ORG_FLAG,
    'include-variants': Flags.boolean({
      description: `Also delete variant CRs (${VARIANT_KIND_LABEL} only)`,
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
    ...AUDIT_TRAIL_FLAGS,
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

    const name = args.name;
    try {
      await withAuditTrail(
        { repo, operation: 'delete', kind, name },
        auditTrailOptions(flags),
        async (audit) => {
          const workflowUrl = await dispatchUnprovision(repo, {
            kind,
            name,
            includeVariants: flags['include-variants'],
            waitForClaimChecks: flags['wait-for-checks'],
          });
          const runUrl = await waitForDispatch(
            repo.api,
            repo.ref,
            workflowUrl,
            {
              noWait: flags['no-wait'],
              claimType: kind,
              claimName: name,
              label: 'Unprovisioning',
              extra: audit.result(),
            },
          );
          // A delete that was merely dispatched may still fail: leave the issue
          // open for the operator.
          if (!flags['no-wait']) {
            await audit.commentRunUrl(runUrl);
            await audit.closeIssue();
          }
        },
      );
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
