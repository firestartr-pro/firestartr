import { IClaim } from '../base';

export interface IArgoDeployClaim extends IClaim {
  type: string;
  lifecycle: string;
  system: string;
  project: string;
  name: string;
  description: string;
  providers: {
    argocd: {
      name: string;
      project: string;
      chart: any;
      values: any;
    };
  };
}

export const schema = 'firestartr.dev://common/ArgoDeployClaim';
