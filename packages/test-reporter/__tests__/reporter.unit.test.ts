import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TestReporter } from '../src/reporter';
import type { KubeConfigProvider, GhApiLike, ExecFn } from '../src/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'test-reporter-'));
}

function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('TestReporter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  describe('record()', () => {
    it('stores artifact records', () => {
      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir },
      );

      reporter.record(
        'FirestartrGithubRepository',
        'my-repo',
        'default',
        'created',
        'ComponentClaim/my-app',
      );

      const json = reporter.toJSON();
      expect(json.artifacts).toHaveLength(1);
      expect(json.artifacts[0]).toEqual({
        kind: 'FirestartrGithubRepository',
        name: 'my-repo',
        namespace: 'default',
        action: 'created',
        timestamp: expect.any(String),
        crdApiVersion: 'firestartr.dev/v1',
        claimRef: 'ComponentClaim/my-app',
      });
    });

    it('keeps duplicate entries for full history', () => {
      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir },
      );

      reporter.record(
        'FirestartrGithubRepository',
        'my-repo',
        'default',
        'created',
      );
      reporter.record(
        'FirestartrGithubRepository',
        'my-repo',
        'default',
        'updated',
      );

      const json = reporter.toJSON();
      expect(json.artifacts).toHaveLength(2);
      expect(json.artifacts[0].action).toBe('created');
      expect(json.artifacts[1].action).toBe('updated');
    });
  });

  describe('snapshot()', () => {
    it('throws when no kubeConfigProvider', async () => {
      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir },
      );

      await expect(reporter.snapshot('default')).rejects.toThrow(
        'snapshot() requires a kubeConfigProvider',
      );
    });

    it('gathers snapshot from k8s when provider is configured', async () => {
      const mockKubeConfig = {
        makeApiClient: jest.fn().mockReturnValue({
          listNamespacedCustomObject: jest.fn().mockResolvedValue({
            body: {
              items: [
                {
                  metadata: { name: 'repo-a' },
                  status: { state: 'PROVISIONED' },
                  spec: { repo: { name: 'repo-a' } },
                },
              ],
            },
          }),
        }),
      };

      const mockKcProvider: KubeConfigProvider = () =>
        mockKubeConfig as unknown as import('@kubernetes/client-node').KubeConfig;

      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir, kubeConfigProvider: mockKcProvider },
      );

      const snap = await reporter.snapshot('default');

      expect(snap.namespace).toBe('default');
      expect(Object.keys(snap.crsByKind).length).toBeGreaterThan(0);
      expect(snap.timestamp).toBeDefined();
    });

    it('appends github info when requested', async () => {
      const mockKubeConfig = {
        makeApiClient: jest.fn().mockReturnValue({
          listNamespacedCustomObject: jest.fn().mockResolvedValue({
            body: { items: [] },
          }),
        }),
      };
      const mockKcProvider: KubeConfigProvider = () =>
        mockKubeConfig as unknown as import('@kubernetes/client-node').KubeConfig;

      const mockGhApi: GhApiLike = {
        listRepos: async () => ['repo-a', 'repo-b'],
        listGroups: async () => ['team-a'],
        listOrgWebhooks: async () => [
          { deliveryUrl: 'https://example.com/hook' },
        ],
        listUsers: async () => ['user-a'],
      };

      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        {
          outputDir: tmpDir,
          ghApi: mockGhApi,
          kubeConfigProvider: mockKcProvider,
        },
      );

      const snap = await reporter.snapshot({
        namespace: 'default',
        includeGithub: true,
      });

      expect(snap.github).toBeDefined();
      expect(snap.github!.repos).toEqual(['repo-a', 'repo-b']);
      expect(snap.github!.groups).toEqual(['team-a']);
      expect(snap.github!.users).toEqual(['user-a']);
      expect(snap.github!.webhooks).toEqual(['https://example.com/hook']);
    });

    it('collects multiple snapshots', async () => {
      const mockKubeConfig = {
        makeApiClient: jest.fn().mockReturnValue({
          listNamespacedCustomObject: jest.fn().mockResolvedValue({
            body: { items: [] },
          }),
        }),
      };
      const mockKcProvider: KubeConfigProvider = () =>
        mockKubeConfig as unknown as import('@kubernetes/client-node').KubeConfig;

      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir, kubeConfigProvider: mockKcProvider },
      );

      await reporter.snapshot('default');
      await reporter.snapshot('kube-system');

      const json = reporter.toJSON();
      expect(json.snapshots).toHaveLength(2);
      expect(json.snapshots[0].namespace).toBe('default');
      expect(json.snapshots[1].namespace).toBe('kube-system');
    });
  });

  describe('setError()', () => {
    it('sets status to failed and stores error info', async () => {
      const mockKubeConfig = {
        makeApiClient: jest.fn().mockReturnValue({
          listNamespacedCustomObject: jest.fn().mockResolvedValue({
            body: { items: [] },
          }),
        }),
      };
      const mockKcProvider: KubeConfigProvider = () =>
        mockKubeConfig as unknown as import('@kubernetes/client-node').KubeConfig;

      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir, kubeConfigProvider: mockKcProvider },
      );

      await reporter.snapshot('default');

      await reporter.setError(
        'expected true to be false',
        'at Object.<anonymous> (__tests__/example.test.ts:10:5)',
        'should render claim',
      );

      const json = reporter.toJSON();
      expect(json.status).toBe('failed');
      expect(json.error).toBeDefined();
      expect(json.error!.message).toBe('expected true to be false');
      expect(json.error!.itName).toBe('should render claim');
      expect(json.error!.testFilePath).toBe('__tests__/example.test.ts');
      expect(json.error!.snapshot).toBeDefined();
    });

    it('includes context when provided', async () => {
      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir },
      );

      await reporter.setError('boom', 'stack', 'test', 'while rendering group');

      const json = reporter.toJSON();
      expect(json.error!.context).toBe('while rendering group');
    });
  });

  describe('setStatus()', () => {
    it('overrides the default passed status', () => {
      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir },
      );

      reporter.setStatus('skipped');

      expect(reporter.toJSON().status).toBe('skipped');
    });
  });

  describe('save()', () => {
    it('writes results JSON to the output directory', () => {
      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        { outputDir: tmpDir },
      );

      reporter.record(
        'FirestartrGithubRepository',
        'repo-a',
        'default',
        'created',
      );
      reporter.save();

      const expectedDir = path.join(tmpDir, '__tests__', 'example');
      const expectedFile = path.join(expectedDir, 'example.results.json');

      expect(fs.existsSync(expectedFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(expectedFile, 'utf-8'));
      expect(content.executionId).toMatch(/^example-\d{8}-\d{6}$/);
      expect(content.testName).toBe('example');
      expect(content.status).toBe('passed');
      expect(content.artifacts).toHaveLength(1);
      expect(content.endedAt).toBeDefined();
    });

    it('creates nested directories as needed', () => {
      const reporter = new TestReporter('src/deep/nested/my.test.ts', 'my', {
        outputDir: tmpDir,
      });

      reporter.save();

      const expectedDir = path.join(tmpDir, 'src', 'deep', 'nested', 'my');
      const expectedFile = path.join(expectedDir, 'my.results.json');
      expect(fs.existsSync(expectedFile)).toBe(true);
    });
  });

  describe('executionId', () => {
    it('contains test file stem and timestamp', () => {
      const reporter = new TestReporter(
        '__tests__/group-render.test.ts',
        'group-render',
        { outputDir: tmpDir },
      );

      const id = reporter.toJSON().executionId;
      expect(id).toMatch(/^group-render-\d{8}-\d{6}$/);
    });
  });

  describe('operator exec integration', () => {
    it('reads operator info via exec when configured', async () => {
      const mockExecFn: ExecFn = jest
        .fn()
        .mockImplementation(
          async (_pod: string, _ns: string, cmd: string[]) => {
            if (cmd.includes('/tmp/queue')) return 'queue-content';
            if (cmd.includes('/tmp/diagnostics')) return 'diag-content';
            return '';
          },
        );

      const mockKubeConfig = {
        makeApiClient: jest.fn().mockReturnValue({
          listNamespacedCustomObject: jest.fn().mockResolvedValue({
            body: { items: [] },
          }),
        }),
      };
      const mockKcProvider: KubeConfigProvider = () =>
        mockKubeConfig as unknown as import('@kubernetes/client-node').KubeConfig;

      const reporter = new TestReporter(
        '__tests__/example.test.ts',
        'example',
        {
          outputDir: tmpDir,
          kubeConfigProvider: mockKcProvider,
          execFn: mockExecFn,
          operatorPodName: 'operator-pod',
        },
      );

      const snap = await reporter.snapshot('default');

      expect(snap.operator.queue).toBe('queue-content');
      expect(snap.operator.diagnostics).toBe('diag-content');
    });
  });
});
