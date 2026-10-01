import { FirestartrGithubMembershipSpecRole } from '../../../imports/firestartr.dev';
import { IUserClaim } from '../base/user';

export interface IGithubMembershipClaim extends IUserClaim {
  providers: {
    github: {
      name: string;
      org: string;
      role: FirestartrGithubMembershipSpecRole;
    };
  };
}
