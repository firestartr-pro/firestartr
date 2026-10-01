import { resolveStringReference } from '../../utils/claimUtils';
import {
  FirestartrGithubGroup,
  FirestartrGithubGroupProps,
  FirestartrGithubGroupSpecPrivacy,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubTeamClaim } from '../../claims/github/group';
import { resolveClaimRef } from '../../refresolver';
import { BaseGithubChart } from './base';
import { GroupVersionKind } from 'cdk8s';

export class GithubGroupChart extends BaseGithubChart {
  template(): FirestartrGithubGroupProps | IUnitializedStateKey {
    const claim: IGithubTeamClaim = this.get('claim');

    const firestartrId: string = this.get('firestartrId');

    const memberRefList: any[] = [];

    for (const memberStringRef of claim.members || []) {
      const member = resolveStringReference(memberStringRef);

      const name = resolveClaimRef(
        member.kind === 'FirestartrGithubGroup' ? 'GroupClaim' : 'UserClaim',

        member.name,
      ).metadata.name;

      memberRefList.push({
        ref: {
          kind: member.kind,

          name,

          needsSecret: member.kind === 'FirestartrGithubGroup' ? true : false,
        },
      });
    }

    const parentTeam = claim.parent
      ? resolveClaimRef('GroupClaim', resolveStringReference(claim.parent).name)
          .metadata.name
      : undefined;

    let parentTeamRef = undefined;

    if (parentTeam) {
      parentTeamRef = {
        ref: {
          kind: 'FirestartrGithubGroup',

          name: parentTeam,

          needsSecret: true,
        },
      };
    }

    return {
      metadata: { name: claim.providers.github.name },

      spec: {
        org: claim.providers.github.org,

        privacy:
          claim.providers.github.privacy ||
          ('closed' as FirestartrGithubGroupSpecPrivacy),

        description: claim.description,

        members: memberRefList,

        parentTeam: parentTeamRef,

        firestartr: { tfStateKey: firestartrId },

        writeConnectionSecretToRef: {
          name: `firestartrgithubgroup-${claim.providers.github.name}-outputs`.toLowerCase(),

          outputs: [{ key: 'id' }, { key: 'nodeId' }, { key: 'slug' }],
        },
      },
    };
  }

  gvk(): GroupVersionKind {
    return FirestartrGithubGroup.GVK;
  }

  instanceApiObject(template: any): FirestartrGithubGroup {
    return new FirestartrGithubGroup(this, template.metadata.name, template);
  }
}
