import { Context } from '../context';
import { KubernetesClient } from '../kubernetes-client';

export abstract class Analyzer {
  cli: KubernetesClient;

  ctx: Context;

  constructor(context: Context, cli: KubernetesClient) {
    this.ctx = context;

    this.cli = cli;
  }

  abstract analyze(): Promise<void>;
}
