import { PatchOperations } from '../../base';
import { EntityGHRepo } from '../';
import log from '../../../logger';

/**
 * Adds branch protection config to the synthesized Terraform config,
 * preserving legacy field semantics exactly (empty lists, explicit booleans, names).
 * @param entity The EntityGHRepo instance
 */
export function provisionBranchProtections(entity: EntityGHRepo) {
  const protections = entity.cr.spec.branchProtections;
  if (!protections || !Array.isArray(protections) || protections.length === 0) {
    return;
  }

  for (const protection of protections) {
    const output: any = {};
    output.branch = protection.branch;
    output.statusChecks =
      'statusChecks' in protection ? (protection.statusChecks ?? []) : [];
    if ('requiredReviewersCount' in protection)
      output.requiredReviewersCount = protection.requiredReviewersCount;
    if ('requiredCodeownersReviewers' in protection)
      output.requiredCodeownersReviewers =
        protection.requiredCodeownersReviewers;
    if ('enforceAdmins' in protection)
      output.enforceAdmins = protection.enforceAdmins;
    if ('requireSignedCommits' in protection)
      output.requireSignedCommits = protection.requireSignedCommits;
    if ('requireConversationResolution' in protection)
      output.requireConversationResolution =
        protection.requireConversationResolution;

    if (protection.bypassPullRequestAllowances) {
      output.bypassPullRequestAllowances = {
        apps: protection.bypassPullRequestAllowances.apps || [],
        teams: protection.bypassPullRequestAllowances.teams || [],
        users: protection.bypassPullRequestAllowances.users || [],
      };
    }

    if (protection.pushAllowances) {
      output.pushAllowances = {
        apps: protection.pushAllowances.apps || [],
        teams: protection.pushAllowances.teams || [],
        users: protection.pushAllowances.users || [],
      };
    }

    log.debug(
      `[gh-provisioner] Adding branch protection config: ${JSON.stringify(output)}`,
    );
    entity.patchData({
      op: PatchOperations.add,
      path: '/config/branch_protections/-',
      value: output,
    });
  }
}
