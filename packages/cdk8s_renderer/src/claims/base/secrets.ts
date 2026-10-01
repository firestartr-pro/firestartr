import { IClaim } from '../base';

export interface ISecretsClaim extends IClaim {
  type: string;
  lifecycle: string;
  system: string;
  name: string;
  providers: any;
  owner: `${string}:${string}`;
}

export const schema = 'firestartr.dev://common/SecretsClaim';
