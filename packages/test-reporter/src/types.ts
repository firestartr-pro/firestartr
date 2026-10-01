import type * as k8s from '@kubernetes/client-node';

export type ArtifactAction = 'created' | 'updated' | 'retrieved' | 'destroyed';

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'error';

export interface ArtifactRecord {
  kind: string;
  name: string;
  namespace: string;
  action: ArtifactAction;
  timestamp: string;
  crdApiVersion: string;
  claimRef?: string;
}

export interface OperatorInfo {
  queue: string;
  diagnostics: string;
}

export interface GithubInfo {
  repos: string[];
  groups: string[];
  users: string[];
  webhooks: string[];
}

export interface SnapshotCrEntry {
  name: string;
  status: unknown;
  tfResults: Array<{ name: string; spec: unknown; status: unknown }>;
}

export interface SnapshotEntry {
  timestamp: string;
  namespace: string;
  crsByKind: Record<string, Array<SnapshotCrEntry>>;
  operator: OperatorInfo;
  github?: GithubInfo;
}

export interface TestError {
  message: string;
  context?: string;
  stackTrace: string;
  testFilePath: string;
  itName: string;
  snapshot?: SnapshotEntry;
}

export interface TestExecutionResult {
  executionId: string;
  testName: string;
  startedAt: string;
  endedAt: string;
  status: TestStatus;
  artifacts: ArtifactRecord[];
  snapshots: SnapshotEntry[];
  error?: TestError;
}

export interface KubeConfigProvider {
  (): k8s.KubeConfig;
}

export interface GhApiLike {
  listRepos(): Promise<string[]>;
  listGroups(): Promise<string[]>;
  listOrgWebhooks(): Promise<Array<{ deliveryUrl: string }>>;
  listUsers?(): Promise<string[]>;
}

export interface ExecFn {
  (podName: string, namespace: string, command: string[]): Promise<string>;
}

export interface TestReporterOptions {
  outputDir?: string;
  kubeConfigProvider?: KubeConfigProvider;
  ghApi?: GhApiLike;
  execFn?: ExecFn;
  operatorNamespace?: string;
  operatorPodName?: string;
}
