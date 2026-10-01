import { IClaim } from '../base';

export interface IUserClaim extends IClaim {
  org: string;
  displayName: string;
  profile: IUserClaimProfile;
  providers: object;
  memberOf?: string[];
}

export interface IUserClaimProfile {
  displayName: string;
  email: string;
  picture: string;
}

export const schema = 'firestartr.dev://common/UserClaim';
