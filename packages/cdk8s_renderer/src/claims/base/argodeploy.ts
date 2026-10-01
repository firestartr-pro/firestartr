import { IClaim } from '../base';

export interface IArgoDeployClaim extends IClaim {
  org: string;
  description: string;
  owner: `${string}:${string}`;
}

export const schema = 'firestartr.dev://common/ArgoDeployClaim';
