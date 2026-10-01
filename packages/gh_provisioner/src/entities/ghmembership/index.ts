import { Entity, PatchOperations } from '../base';

import log from '../../logger';

import github from 'github';

import { allGroupMembershipRelationExists } from './helpers';

export class EntityGHMembership extends Entity {
  teamAllId: number | undefined;

  constructor(artifact: any) {
    super(artifact, {
      config: {
        relationships: [],
      },
    });
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    try {
      this.patchData({
        path: '/config/user',

        op: PatchOperations.add,

        value: {
          username: this.cr.name,

          role: this.cr.spec.role,
        },
      });

      await this.provisionAllGroupMembershipRelation();

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);

      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );

      throw new Error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );
    }
  }

  async postProvision(tfOp: string): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {
    this.patchImportData({
      op: PatchOperations.add,

      path: '/imports/-',

      value: {
        to: 'github_membership.this[0]',
        id: `${this.cr.spec.org}:${this.cr.name}`,
      },
    });

    const userIsInAllTeam = await allGroupMembershipRelationExists(this);

    for (const relationship of this.document.config.relationships) {
      if (!userIsInAllTeam && relationship.teamId === this.teamAllId) {
        log.debug(
          `[gh-provisioner] skipping import for ${this.k8sId} relationship to all team because it does not exist in GitHub and will be created instead`,
        );
        continue;
      }

      this.patchImportData({
        op: PatchOperations.add,

        path: '/imports/-',

        value: {
          to: `github_team_membership.relationships["${relationship.username}-${relationship.teamId}"]`,

          id: `${relationship.teamId}:${relationship.username}`,
        },
      });
    }
  }

  async provisionAllGroupMembershipRelation() {
    // Every org member must belong to the <org>-all team so they receive base
    // access.  If that team is missing the provider likely points at the wrong
    // org, so we surface a clear error guiding the user toward the correct field.
    log.debug('[gh-provisioner] provisioning all group membership relation');
    // we need to get the <org>-all group teamId
    const allTeamName = `${this.cr.spec.org}-all`;
    let teamInfo: any;

    try {
      teamInfo = await this.runWithGithubProvider(async () => {
        return (await github.team.getTeamInfo(
          allTeamName,
          this.cr.spec.org,
        )) as any;
      });
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      const message = err instanceof Error ? err.message : String(err);
      const isNotFound = status === 404 || message.includes('Not Found');

      if (isNotFound) {
        const claimRef =
          this.cr.metadata?.annotations?.['firestartr.dev/claim-ref'] ||
          'unknown claim';

        throw new Error(
          `Could not find required GitHub team "${allTeamName}" in org "${this.cr.spec.org}" while loading membership for user "${this.cr.name}" (${claimRef}). Check UserClaim.providers.github.org / FirestartrGithubMembership.spec.org; it must point to the organization where the "<org>-all" team exists. Original error: ${message}`,
        );
      }

      throw err;
    }

    log.debug(
      `[gh-provisioner] got team info for org-all team: ${teamInfo.id}`,
    );

    this.teamAllId = teamInfo.id;

    this.patchData({
      path: '/config/relationships/-',

      op: PatchOperations.add,

      value: {
        username: this.cr.name,

        teamId: teamInfo.id,

        role: 'member',
      },
    });
  }
}
