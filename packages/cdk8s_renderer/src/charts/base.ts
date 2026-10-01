import { Chart } from 'cdk8s';
import { Construct } from 'constructs';
import { ApiObject, GroupVersionKind } from 'cdk8s';

//import * as jspatch  from "fast-json-patch"

import { resolveClaimRef } from '../refresolver';
import { ICustomResourcePatch } from '../patches';

import { helperIsPatchApplicable } from './helpers';

export class ChartRenderError extends Error {
  constructor(kind: string, name: string, message: string) {
    super(`Error rendering ${kind} ${name}: ${message}`);
  }
}

export abstract class BaseChart extends Chart {
  data: any = {};

  refResolver = (claimKind: string, claimName: string) => {
    return resolveClaimRef(claimKind, claimName);
  };

  constructor(
    scope: Construct,

    chartId: string,

    firestartrId: string | null,

    claim: any,

    patches: ICustomResourcePatch[] = [],
  ) {
    super(scope, chartId, {});

    this.set('claim', claim);

    this.set('firestartrId', firestartrId);

    this.set('patches', patches);
  }

  filteredPatches(patches = this.get('patches')) {
    const patchesfiltered = patches.filter((patch: any) => {
      return helperIsPatchApplicable(this, patch);
    });

    return patchesfiltered;
  }

  async render() {
    let template: any = this.template();

    const patches: ICustomResourcePatch[] = this.filteredPatches();

    for (const patch of patches) {
      patch.ctx = () => this.ctx();

      template = await patch.apply(template, this.ctx());

      patch.validate(template);
    }

    this.set('rendered-cr', template);

    return this;
  }

  async postRenderer(patches: ICustomResourcePatch[]) {
    let template: any = this.get('rendered-cr');

    for (const patch of this.filteredPatches(patches)) {
      patch.ctx = () => this.ctx();

      template = await patch.apply(template, this.ctx());

      patch.validate(template);
    }

    return this.instanceApiObject(template);
  }

  ctx() {
    return new ChartContext(this);
  }

  get(k: string): any {
    return this.data[k];
  }

  set(k: string, v: any) {
    this.data[k] = v;
  }

  extraCharts(): {
    claim: { kind: string; name: string };
    chart: ApiObject;
  }[] {
    return [];
  }

  abstract instanceApiObject(template: ApiObject): ApiObject;

  abstract template(): any;

  abstract gvk(): GroupVersionKind;
}

export class ChartContext {
  chart: BaseChart;

  refClaims: any = {};

  constructor(chart: BaseChart) {
    this.chart = chart;
  }

  get kind() {
    return this.chart.gvk().kind;
  }

  get provider() {
    return this.chart.get('provider');
  }

  refResolution(claimKind: string, claimName: string) {
    return this.chart.refResolver(claimKind, claimName);
  }
}
