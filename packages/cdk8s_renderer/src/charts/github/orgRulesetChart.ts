import {
  FirestartrGithubOrgRuleset,
  FirestartrGithubOrgRulesetProps,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubOrgRulesetClaim } from '../../claims/github/orgRuleset';
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
        // Same shape as the Terraform module config, so it is copied as is
        ruleset: {
          name: github.name,
          target: github.target,
          enforcement: github.enforcement,
          conditions: github.conditions,
          rules: github.rules,
          bypassActors: github.bypass_actors,
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
