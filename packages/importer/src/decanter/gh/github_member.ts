import github from 'github';
import { GithubDecanter } from './base';
import { getConfigPath } from '../config';
import log from '../../logger';
import * as path from 'path';

export default class MemberGithubDecanter extends GithubDecanter {
  claimKind = 'UserClaim';

  __decantStart() {
    this.claim = {
      kind: this.claimKind,

      version: this.VERSION(),

      name: this.data.memberDetails.login.toLowerCase(),

      profile: {
        displayName: this.data.memberDetails.login,

        email: this.data.memberDetails.email
          ? this.data.memberDetails.email
          : `${this.data.memberDetails.login}@`,

        picture: `${this.data.memberDetails.avatar_url}`,
      },
    };
  }

  async __gatherRoleInOrg() {
    const role = await github.org.getUserRoleInOrg(
      this.data.memberDetails.login,
      this.org,
    );

    this.data.roleDetails = role;
  }

  __decantProviders() {
    this.__patchClaim({
      op: 'add',

      value: {
        github: {
          name: this.data.memberDetails.login,

          org: this.org,

          role: this.data.roleDetails,
        },
      },
      path: '/providers',
    });
  }

  async __adaptInitializerBase(_claim: any) {
    return await this.__loadInitializer('defaults_github_membership.yaml');
  }
}
