import * as fs from 'fs';
import * as path from 'path';
import type {
  ArtifactRecord,
  ArtifactAction,
  TestStatus,
  TestError,
  TestExecutionResult,
  SnapshotEntry,
  TestReporterOptions,
  KubeConfigProvider,
  GhApiLike,
  ExecFn,
} from './types';
import { createArtifactRecord, resolveOperatorNamespace } from './artifacts';
import { gatherSnapshot } from './snapshot';

export class TestReporter {
  private readonly outputDir: string;
  private readonly testFilePath: string;
  private readonly testName: string;
  private readonly executionId: string;
  private readonly startedAt: string;
  private readonly kubeConfigProvider?: KubeConfigProvider;
  private readonly ghApi?: GhApiLike;
  private readonly execFn?: ExecFn;
  private readonly operatorNamespace: string;
  private readonly operatorPodName?: string;

  private artifacts: ArtifactRecord[] = [];
  private snapshots: SnapshotEntry[] = [];
  private status: TestStatus = 'passed';
  private error?: TestError;
  private endedAt?: string;

  constructor(
    testFilePath: string,
    testName: string,
    options: TestReporterOptions = {},
  ) {
    this.testFilePath = testFilePath;
    this.testName = testName;
    this.executionId = this.buildExecutionId(testFilePath);
    this.startedAt = new Date().toISOString();
    this.outputDir =
      options.outputDir ??
      process.env['E2E_EXECUTION_OUTPUT_DIR'] ??
      './test-executions/';
    this.kubeConfigProvider = options.kubeConfigProvider;
    this.ghApi = options.ghApi;
    this.execFn = options.execFn;
    this.operatorNamespace =
      options.operatorNamespace ?? resolveOperatorNamespace();
    this.operatorPodName = options.operatorPodName;
  }

  record(
    kind: string,
    name: string,
    namespace: string,
    action: ArtifactAction,
    claimRef?: string,
  ): void {
    this.artifacts.push(
      createArtifactRecord(kind, name, namespace, action, claimRef),
    );
  }

  async snapshot(namespace?: string): Promise<SnapshotEntry>;
  async snapshot(options: {
    namespace?: string;
    includeGithub?: boolean;
  }): Promise<SnapshotEntry>;
  async snapshot(
    optionsOrNamespace?:
      | string
      | { namespace?: string; includeGithub?: boolean },
  ): Promise<SnapshotEntry> {
    const opts =
      typeof optionsOrNamespace === 'string'
        ? { namespace: optionsOrNamespace }
        : (optionsOrNamespace ?? {});

    const ns = opts.namespace ?? this.operatorNamespace;

    if (!this.kubeConfigProvider) {
      throw new Error(
        'snapshot() requires a kubeConfigProvider. ' +
          'Pass kubeConfigProvider in TestReporterOptions.',
      );
    }

    const k8sSnapshot = await gatherSnapshot({
      kubeConfigProvider: this.kubeConfigProvider,
      ghApi: this.ghApi,
      namespace: ns,
      includeGithub: opts.includeGithub,
      execFn: this.execFn,
      operatorPodName: this.operatorPodName,
    });

    const snapshot: SnapshotEntry = {
      timestamp: new Date().toISOString(),
      namespace: ns,
      crsByKind: k8sSnapshot.crsByKind,
      operator: k8sSnapshot.operator,
      ...(k8sSnapshot.github !== undefined
        ? { github: k8sSnapshot.github }
        : {}),
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async setError(
    message: string,
    stackTrace: string,
    itName: string,
    context?: string,
  ): Promise<void> {
    this.status = 'failed';
    let snapshot: SnapshotEntry | undefined;
    try {
      snapshot = await this.snapshot();
    } catch {
      // snapshot() throws when kubeConfigProvider is missing;
      // still record the error so test failures are never silently lost.
    }
    this.error = {
      message,
      context,
      stackTrace,
      testFilePath: this.testFilePath,
      itName,
      ...(snapshot !== undefined ? { snapshot } : {}),
    };
  }

  setStatus(status: TestStatus): void {
    this.status = status;
  }

  toJSON(): TestExecutionResult {
    return {
      executionId: this.executionId,
      testName: this.testName,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? new Date().toISOString(),
      status: this.status,
      artifacts: this.artifacts,
      snapshots: this.snapshots,
      ...(this.error !== undefined ? { error: this.error } : {}),
    };
  }

  save(): void {
    this.endedAt = new Date().toISOString();
    const result = this.toJSON();
    const filename = this.deriveFilename(this.testFilePath);
    const dir = this.resolveOutputDir(filename);

    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${filename}.results.json`);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  }

  private buildExecutionId(testFilePath: string): string {
    const stem = this.deriveFilename(testFilePath);
    const now = new Date();
    const datePart = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const timePart = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    return `${stem}-${datePart}-${timePart}`;
  }

  private deriveFilename(testFilePath: string): string {
    const basename = path.basename(testFilePath);
    return basename.replace(/\.test\.(ts|js|tsx|jsx)$/, '');
  }

  private resolveOutputDir(filename: string): string {
    const testDir = path.isAbsolute(this.testFilePath)
      ? path.relative(process.cwd(), path.dirname(this.testFilePath))
      : path.dirname(this.testFilePath);
    return path.join(this.outputDir, testDir, filename);
  }
}
