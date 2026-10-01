import { IClaim } from '../base';

export interface IDomainClaim extends IClaim {
  org: string;
  description: string;
  owner: `${string}:${string}`;
}

export const schema = 'firestartr.dev://common/DomainClaim';
