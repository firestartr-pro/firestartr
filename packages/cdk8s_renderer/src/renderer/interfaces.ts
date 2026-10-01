import { ApiObject } from 'cdk8s';

export interface IRenderClaimResult {
  catalogEntity?: ApiObject;

  firestartrEntity?: ApiObject;

  extraCharts: {
    claim: {
      kind: string;
      name: string;
    };
    chart: ApiObject;
  }[];
}
