import {
  FirestartrGithubMembership,
  FirestartrGithubMembershipProps,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubMembershipClaim } from '../../claims/github/membership';
import { BaseGithubChart } from './base';

export class GithubMembershipChart extends BaseGithubChart {
  public template(): FirestartrGithubMembershipProps | IUnitializedStateKey {
    const claim: IGithubMembershipClaim = this.get('claim');

    const firestartrId: string = this.get('firestartrId');

    return {
      metadata: {
        name: claim.providers.github.name,
      },

      spec: {
        org: claim.providers.github.org,

        firestartr: {
          tfStateKey: firestartrId,
        },

        role: claim.providers.github.role,

        writeConnectionSecretToRef: {
          name: `firestartrgithubmembership-${claim.providers.github.name}-outputs`.toLowerCase(),

          outputs: [],
        },
      },
    };
  }

  gvk() {
    return FirestartrGithubMembership.GVK;
  }

  instanceApiObject(template: any): FirestartrGithubMembership {
    return new FirestartrGithubMembership(
      this,

      template.metadata.name,

      template,
    );
  }
}
