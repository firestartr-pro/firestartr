import github from 'github';
import common from 'catalog_common';
import * as fs from 'fs';
import * as path from 'path';
import { GithubDecanter } from './base';
import { InitializerDefault } from 'cdk8s_renderer';
import log from '../../logger';

export default class GroupGithubDecanter extends GithubDecanter {
  claimKind = 'GroupClaim';

  __decantStart() {
    this.claim = {
      kind: this.claimKind,

      version: this.VERSION(),

      name: this.data.groupDetails.slug,

      description: this.data.groupDetails.description || '',

      type: 'business-unit',
    };
  }

  __decantProfile() {
    this.__patchClaim({
      op: 'add',

      value: {
        displayName: this.data.groupDetails.name,
      },

      path: '/profile',
    });
  }

  __decantMembers() {
    if (this.data.groupDetails.name === `${this.org}-all`) {
      log.debug(
        `Skipping adding members for virtual ${this.data.groupDetails.name} group`,
      );
    } else {
      this.__patchClaim({
        op: 'add',

        value: this.data.members.map(
          (member: any) => `user-imported-ref:${member.name}`,
        ),

        path: '/members',
      });
    }
  }

  __decantProviders() {
    this.__patchClaim({
      op: 'add',

      value: {
        github: { name: `${this.data.groupDetails.name}`, org: this.org },
      },

      path: '/providers',
    });
  }

  __decantParent() {
    if (this.data.groupDetails.parent) {
      this.__patchClaim({
        op: 'add',

        value: `group-imported-ref:${this.data.groupDetails.parent.name}`,

        path: '/parent',
      });
    }
  }

  async __gatherMembers() {
    this.data['members'] = (
      await github.team.getTeamMembers(
        this.data.groupDetails.slug,

        this.org,
      )
    ).map((member: any) => {
      return { name: member.login, role: member.role };
    });
  }

  async __validateMembers(cr: any) {
    const members = cr.spec.members.map((member: any) => member.ref.name);

    return this.__validateEqual(members, this.data.members);
  }

  async __adaptInitializerBase(_claim: any) {
    return await this.__loadInitializer('defaults_github_group.yaml');
  }

  __postRenderAnnotateGithubId() {
    this.setPostRenderF((cr) => {
      return this.__patchCr(
        cr,

        {
          op: 'add',

          path: '/metadata/annotations/firestartr.dev~1github-id',

          value: `${this.data.groupDetails.id}`,
        },
      );
    });
  }

  __validateKind(cr: any) {
    return true;
  }

  KO__validateKind() {}
}
