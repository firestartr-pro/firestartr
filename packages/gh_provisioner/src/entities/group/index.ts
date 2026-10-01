import { Entity, PatchOperations } from '../base';

import log from '../../logger';

export class EntityGroup extends Entity {
  constructor(artifact: any) {
    super(artifact, {
      config: {
        group: {},

        group_members: [],
      },
    });
  }

  async loadResources(): Promise<void> {
    try {
      const parentTeam = this.cr.spec.parentTeam
        ? Entity.refResolver(this.cr.spec.parentTeam.ref)
        : null;

      this.patchData({
        path: '/config/group',

        op: PatchOperations.replace,

        value: {
          name: this.cr.name,

          description: this.cr.spec.description,

          privacy: this.cr.spec.privacy,
        },
      });

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);

      if (parentTeam !== null) {
        log.info(`[gh-provisioner] ${this.k8sId} has a parentTeam`);

        this.patchData({
          path: '/config/group/parentTeamId',
          op: PatchOperations.add,
          value: parentTeam.getOutput('id'),
        });
      }

      await this.loadGroupMembers();

      this.synthMessage('Synth finished');

      this.synthEnd(JSON.stringify(this.document, null, 2));
    } catch (err) {
      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`,
      );

      throw `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`;
    }
  }

  async postProvision(tfOp: string): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {
    this.patchImportData({
      op: PatchOperations.add,

      path: '/imports/-',

      value: {
        to: 'github_team.this',
        id: this.cr.id,
      },
    });

    for (const member of this.document.config.group_members) {
      this.patchImportData({
        op: PatchOperations.add,

        path: '/imports/-',

        value: {
          to: `github_team_membership.members["${member.username}"]`,

          id: `${this.cr.id}:${member.username}`,
        },
      });
    }
  }

  async loadGroupMembers() {
    const members = [];

    const teamId = this.cr.id || null;

    log.debug(`[gh-provisioner] ${this.k8sId} has teamId ${teamId}`);

    for (const member of this.cr.spec.members) {
      if (member.ref.kind === 'FirestartrGithubMembership') {
        const memberRef = Entity.refResolver(member.ref);

        const memberData = {
          username: memberRef.getDepName(),

          role: member.role,
        };

        if (teamId) {
          memberData['teamId'] = teamId;
        }

        members.push(memberData);
      }
    }

    log.info(`[gh-provisioner] ${this.k8sId} has ${members.length} members`);

    this.patchData({
      path: '/config/group_members',

      op: PatchOperations.replace,

      value: members,
    });
  }
}
