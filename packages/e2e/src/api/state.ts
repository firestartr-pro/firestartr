import type { KubeConfigProvider } from '../k8s/types';
import type { RenderedArtifact, TestContext } from '../types';

type E2EStateOptions = {
  org: string;
  namespace: string;
  prefix: string;
  kubeConfigProvider: KubeConfigProvider;
  fixturesBasePath?: string;
  onlyFiles?: string[];
};

export class E2EState {
  org: string;
  namespace: string;
  prefix: string;
  context: TestContext | null = null;
  kubeConfigProvider: KubeConfigProvider;
  fixturesBasePath?: string;
  onlyFiles?: string[];
  lastRenderedCrsPath?: string;
  renderedArtifacts: RenderedArtifact[] = [];

  constructor(options: E2EStateOptions) {
    this.org = options.org;
    this.namespace = options.namespace;
    this.prefix = options.prefix;
    this.kubeConfigProvider = options.kubeConfigProvider;
    this.fixturesBasePath = options.fixturesBasePath;
    this.onlyFiles = options.onlyFiles;
  }
}
