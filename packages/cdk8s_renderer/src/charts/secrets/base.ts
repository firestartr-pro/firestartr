import { ICustomResourcePatch } from '../../patches';
import { BaseChart } from '../base';
import { Construct } from 'constructs';

export abstract class BaseSecretsChart extends BaseChart {
  constructor(
    scope: Construct,

    chartId: string,

    firestartrId: string | null,

    claim: any,

    patches: ICustomResourcePatch[] = [],
  ) {
    super(scope, chartId, firestartrId, claim, patches);

    this.set('provider', 'secrets');
  }
}
