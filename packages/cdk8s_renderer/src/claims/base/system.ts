import { IClaim } from '../base';

export interface ISystemClaim extends IClaim {
  org: string;
  description: string;
  owner: `${string}:${string}`;
  domain: string;
}

export const schema = 'firestartr.dev://common/SystemClaim';
