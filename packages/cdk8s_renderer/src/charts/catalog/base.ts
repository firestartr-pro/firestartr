import { Construct } from 'constructs';
import { BaseChart } from '../base';
import { ICustomResourcePatch } from '../../patches';

export abstract class BaseCatalogChart extends BaseChart {
  constructor(
    scope: Construct,

    chartId: string,

    firestartrId: string | null,

    claim: any,

    patches: ICustomResourcePatch[] = [],
  ) {
    super(scope, chartId, firestartrId, claim, patches);

    this.set('provider', 'catalog');
  }
}
