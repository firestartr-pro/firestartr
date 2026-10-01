import { FirestartrGithubGroupSpecPrivacy } from '../../../imports/firestartr.dev';
import { IGroupClaim } from '../base/group';

export interface IGithubTeamClaim extends IGroupClaim {
  providers: {
    github: {
      description: string;
      name: string;
      privacy: FirestartrGithubGroupSpecPrivacy;
      org: string;
    };
  };
}
