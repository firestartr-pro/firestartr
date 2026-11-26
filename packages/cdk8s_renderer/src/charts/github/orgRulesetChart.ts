import {
  FirestartrGithubOrgRuleset,
  FirestartrGithubOrgRulesetProps,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubOrgRulesetClaim } from '../../claims/github/orgRuleset';
import { resolveStringReference } from '../../utils/claimUtils';
import { resolveComponentRepository } from '../../utils/repositoryClaimUtils';
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
          conditions: this.renderConditions(claim),
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

  private renderConditions(claim: IGithubOrgRulesetClaim): any {
    const conditions = claim.providers.github.conditions;
    const repositoryName = (conditions as any)?.repository_name;

    if (!repositoryName) return conditions;

    return {
      ...conditions,
      repository_name: {
        ...repositoryName,
        ...(repositoryName.include !== undefined
          ? {
              include: this.renderRepositoryNames(
                claim,
                repositoryName.include,
              ),
            }
          : {}),
        ...(repositoryName.exclude !== undefined
          ? {
              exclude: this.renderRepositoryNames(
                claim,
                repositoryName.exclude,
              ),
            }
          : {}),
      },
    };
  }

  private renderRepositoryNames(
    claim: IGithubOrgRulesetClaim,
    refs: string[],
  ): string[] {
    const github = claim.providers.github;

    return (refs ?? []).map((ref) => {
      const match = String(ref).match(/^component:(.+)$/);
      if (!match) return ref;

      const { org, repoName } = resolveComponentRepository(
        match[1],
        this.refResolver,
      );

      if (!org || !repoName) {
        throw new ChartRenderError(
          'OrgRulesetClaim',
          claim.name,
          `Referenced component "${match[1]}" has no GitHub provider configured`,
        );
      }

      if (org !== github.org) {
        throw new ChartRenderError(
          'OrgRulesetClaim',
          claim.name,
          `Referenced component "${match[1]}" belongs to organization "${org}" but the ruleset targets "${github.org}"`,
        );
      }

      return repoName;
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
