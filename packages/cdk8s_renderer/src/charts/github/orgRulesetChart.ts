import {
  FirestartrGithubOrgRuleset,
  FirestartrGithubOrgRulesetProps,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubOrgRulesetClaim } from '../../claims/github/orgRuleset';
import { resolveStringReference } from '../../utils/claimUtils';
import { ChartRenderError } from '../base';
import { BaseGithubChart } from './base';

export class GithubOrgRulesetChart extends BaseGithubChart {
  public template(): FirestartrGithubOrgRulesetProps | IUnitializedStateKey {
    const claim: IGithubOrgRulesetClaim = this.get('claim');
    const firestartrId: string = this.get('firestartrId');
    const github = claim.providers.github;

    return {
      metadata: {
        name: github.name,
      },

      spec: {
        org: github.org,
        // Same shape as the Terraform module config, except Team bypass
        // actors. Those reference a GroupClaim, so they are rendered as a
        // FirestartrGithubGroup ref and the provisioner resolves the ref to
        // the numeric team id.
        ruleset: {
          name: github.name,
          target: github.target,
          enforcement: github.enforcement,
          conditions: github.conditions,
          rules: github.rules,
          bypassActors: github.bypass_actors
            ? this.renderBypassActors(claim)
            : undefined,
        },
        firestartr: {
          tfStateKey: firestartrId,
        },
        writeConnectionSecretToRef: {
          name: `firestartrgithuborgruleset-${github.name}-outputs`.toLowerCase(),
          outputs: [{ key: 'ruleset_id' }, { key: 'node_id' }, { key: 'etag' }],
        },
      },
    };
  }

  private renderBypassActors(claim: IGithubOrgRulesetClaim): any[] {
    const github = claim.providers.github;

    return (github.bypass_actors ?? []).map((actor) => {
      if (actor.actor_type !== 'Team') {
        if (actor.group !== undefined) {
          throw new ChartRenderError(
            'OrgRulesetClaim',
            claim.name,
            `group is only valid for Team bypass actors, not ${actor.actor_type}`,
          );
        }

        return actor;
      }

      if (!actor.group) {
        throw new ChartRenderError(
          'OrgRulesetClaim',
          claim.name,
          'Team bypass actors must reference a group claim with group: "group:<name>"',
        );
      }

      const { name } = resolveStringReference(actor.group);
      const groupCr = this.refResolver('GroupClaim', name);

      if (groupCr?.spec?.org !== github.org) {
        throw new ChartRenderError(
          'OrgRulesetClaim',
          claim.name,
          `Team bypass actor "${actor.group}" belongs to organization "${groupCr?.spec?.org}" but the ruleset targets "${github.org}"`,
        );
      }

      return {
        actor_type: actor.actor_type,
        bypass_mode: actor.bypass_mode,
        ref: {
          kind: 'FirestartrGithubGroup',
          name: groupCr.metadata.name,
          needsSecret: true,
        },
      };
    });
  }

  gvk() {
    return FirestartrGithubOrgRuleset.GVK;
  }

  instanceApiObject(template: any): FirestartrGithubOrgRuleset {
    return new FirestartrGithubOrgRuleset(
      this,
      template.metadata.name,
      template,
    );
  }
}
