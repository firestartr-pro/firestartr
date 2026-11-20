import { IClaim } from '../base';

export interface IOrgRulesetClaim extends IClaim {
  system?: string;
  owner: string;
  providers: object;
}

export const schema = 'firestartr.dev://common/OrgRulesetClaim';
