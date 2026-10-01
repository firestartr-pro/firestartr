import github from 'github';

import type { EntityGHMembership } from '..';

import log from '../../../logger';

export async function allGroupMembershipRelationExists(
  ghMember: EntityGHMembership,
): Promise<boolean> {
  // we need to check if the relationships already exist
  // in the allTeam if not we should not attempt to import
  const allTeamName = `${ghMember.cr.spec.org}-all`;

  const existsRelation = (await ghMember.runWithGithubProvider(async () => {
    try {
      await github.team.getTeamRoleUser(
        ghMember.cr.spec.org,
        allTeamName,
        ghMember.cr.name,
      );

      return true;
    } catch (error) {
      if (error && error.status === 404) {
        return false;
      }

      throw error;
    }
  })) as boolean;

  log.debug(
    `[gh-provisioner] existsRelation with allGroup for ${ghMember.cr.name}: ${existsRelation ? 'yes' : 'no'}`,
  );

  return existsRelation;
}
