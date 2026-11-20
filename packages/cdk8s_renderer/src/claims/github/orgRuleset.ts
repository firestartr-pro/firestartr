import {
  FirestartrGithubOrgRulesetSpecRulesetEnforcement,
  FirestartrGithubOrgRulesetSpecRulesetTarget,
} from '../../../imports/firestartr.dev';
import { IOrgRulesetClaim } from '../base/orgRuleset';

export interface IGithubOrgRulesetClaim extends IOrgRulesetClaim {
  providers: {
    github: {
      name: string;
      org: string;
      target: FirestartrGithubOrgRulesetSpecRulesetTarget;
      enforcement: FirestartrGithubOrgRulesetSpecRulesetEnforcement;
      conditions: {
        ref_name?: object;
        repository_name?: object;
        repository_property?: object;
      };
      rules?: { type: string; parameters?: object }[];
      bypass_actors?: {
        actor_type: string;
        actor_id?: number;
        actor_slug?: string;
        actor_role?: string;
        bypass_mode: string;
      }[];
    };
  };
}
