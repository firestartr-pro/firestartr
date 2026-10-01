export { TestReporter } from './src/reporter';
export { createArtifactRecord } from './src/artifacts';
export { gatherSnapshot } from './src/snapshot';
export { gatherGithubInfo } from './src/github-info';
export {
  readOperatorInfoViaFs,
  readOperatorInfoViaExec,
} from './src/operator-info';
export type {
  ArtifactRecord,
  ArtifactAction,
  TestStatus,
  TestError,
  TestExecutionResult,
  SnapshotEntry,
  OperatorInfo,
  GithubInfo,
  KubeConfigProvider,
  GhApiLike,
  ExecFn,
  TestReporterOptions,
} from './src/types';
