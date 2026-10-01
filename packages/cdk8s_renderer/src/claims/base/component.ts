import { IClaim } from '../base';

export interface IApiDefinition {
  name: string;
  definitionfile: string;
  type: string;
}

export interface IComponentClaim extends IClaim {
  type: string;
  lifecycle: string;
  system: string;
  owner: `${string}:${string}`;
  name: string;
  subComponentOf?: string;
  providers: object;
  platformOwner?: `${string}:${string}`;
  maintainedBy?: `${string}:${string}`[];
  providesApis?: IApiDefinition[] | Record<string, IApiDefinition>;
  consumesApis?: string[];
}

export const schema = 'firestartr.dev://common/ComponentClaim';
