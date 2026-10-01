import { Context } from '../context';
import { Analyzer } from './base';
import { Cr } from '../models/cr';
import { KubernetesClient } from '../kubernetes-client';

export class CrsAnalyzer extends Analyzer {
  drifted: Cr[] = [];

  failed: Cr[] = [];

  constructor(context: Context, cli: KubernetesClient) {
    super(context, cli);
  }

  async analyze(): Promise<void> {
    const crs = await this.listCrs();

    this.drifted = this.filterByDrifted(crs);

    this.failed = this.filterByFailed(crs);
  }

  async listCrs(): Promise<Cr[]> {
    const list = await this.cli.listKind(
      this.ctx.apiGroup,
      this.ctx.apiVersion,
      this.ctx.namespace,
      this.ctx.plural,
    );

    return list.map(
      (item: any) => new Cr(item.kind, item.metadata, item.status.conditions),
    );
  }

  filterByFailed(workspaces: Cr[]) {
    return workspaces.filter((ws) => ws.hasError());
  }

  filterByDrifted(workspaces: Cr[]) {
    return workspaces.filter((ws) => ws.isDrifted());
  }
}
