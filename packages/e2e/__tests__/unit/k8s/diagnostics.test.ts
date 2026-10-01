import {
  E2E_DIAGNOSTIC_BEGIN,
  E2E_DIAGNOSTIC_END,
  logCrDiagnostics,
} from '../../../src/k8s/diagnostics';

// Mock module-level dependencies so we can control what the diagnostics
// function sees without hitting the cluster.
jest.mock('../../../src/k8s/manifests');
jest.mock('../../../src/k8s/wait');
jest.mock('../../../src/k8s/tfresult');

import { getPrimaryManifestResource } from '../../../src/k8s/manifests';
import { readResource } from '../../../src/k8s/wait';
import { findTFResultsByReference } from '../../../src/k8s/tfresult';
import type { KubeConfigProvider } from '../../../src/k8s/types';
import type * as k8s from '@kubernetes/client-node';

const mockGetPrimary = getPrimaryManifestResource as jest.MockedFunction<
  typeof getPrimaryManifestResource
>;
const mockReadResource = readResource as jest.MockedFunction<
  typeof readResource
>;
const mockFindTFResults = findTFResultsByReference as jest.MockedFunction<
  typeof findTFResultsByReference
>;

// Build a kubeConfigProvider whose CoreV1Api returns empty lists by default.
function buildMockProvider(
  overrides: {
    listNamespacedEvent?: jest.Mock;
    listNamespacedPod?: jest.Mock;
    readNamespacedPodLog?: jest.Mock;
  } = {},
): KubeConfigProvider {
  const coreV1Api = {
    listNamespacedEvent:
      overrides.listNamespacedEvent ??
      jest.fn().mockResolvedValue({ body: { items: [] } }),
    listNamespacedPod:
      overrides.listNamespacedPod ??
      jest.fn().mockResolvedValue({ body: { items: [] } }),
    readNamespacedPodLog:
      overrides.readNamespacedPodLog ??
      jest.fn().mockResolvedValue({ body: '' }),
  };

  const mockKubeConfig = {
    makeApiClient: jest.fn().mockReturnValue(coreV1Api),
  } as unknown as k8s.KubeConfig;

  return () => mockKubeConfig;
}

const FAKE_CR_PATH = '/tmp/rendered/FirestartrGithubGroup-my-group.yaml';

const FAKE_RESOURCE = {
  apiVersion: 'firestartr.dev/v1',
  kind: 'FirestartrGithubGroup',
  metadata: { name: 'my-group', namespace: 'default' },
  status: {
    conditions: [
      {
        type: 'ERROR',
        status: 'True',
        reason: 'DLH',
        message: 'Uncontrolled error (DLH)',
        lastTransitionTime: '2026-05-01T12:00:00Z',
      },
    ],
  },
};

const FAKE_TFRESULT = {
  apiVersion: 'firestartr.dev/v1',
  kind: 'TFResult',
  metadata: { name: 'my-group-apply' },
  spec: {
    action: 'apply' as const,
    reference: { refKind: 'FirestartrGithubGroup', refName: 'my-group' },
    result: 'Error: resource not found',
  },
};

describe('logCrDiagnostics', () => {
  let errorLines: string[];

  beforeEach(() => {
    errorLines = [];
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errorLines.push(...String(chunk).trimEnd().split('\n'));
      return true;
    });

    mockGetPrimary.mockResolvedValue(FAKE_RESOURCE);
    mockReadResource.mockResolvedValue({
      ...FAKE_RESOURCE,
      status: { conditions: FAKE_RESOURCE.status.conditions },
    });
    mockFindTFResults.mockResolvedValue([FAKE_TFRESULT]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('wraps output in BEGIN/END markers containing resource identity', async () => {
    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('timeout'),
    );

    const beginLine = errorLines.find((l) => l.includes(E2E_DIAGNOSTIC_BEGIN));
    const endLine = errorLines.find((l) => l.includes(E2E_DIAGNOSTIC_END));

    expect(beginLine).toBeDefined();
    expect(beginLine).toContain('FirestartrGithubGroup/my-group');
    expect(endLine).toBeDefined();
    expect(errorLines.indexOf(beginLine!)).toBeLessThan(
      errorLines.indexOf(endLine!),
    );
  });

  it('includes the failure message', async () => {
    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('wait timed out'),
    );

    expect(errorLines.some((l) => l.includes('wait timed out'))).toBe(true);
  });

  it('formats relevant live resource ERROR condition', async () => {
    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('fail'),
    );

    const conditionLines = errorLines.filter((l) => l.includes('type=ERROR'));
    expect(conditionLines.length).toBeGreaterThan(0);
    expect(conditionLines[0]).toContain('reason=DLH');
    expect(conditionLines[0]).toContain('Uncontrolled error (DLH)');
  });

  it('includes TFResult details for each result', async () => {
    const second = {
      ...FAKE_TFRESULT,
      metadata: { name: 'my-group-plan' },
      spec: { ...FAKE_TFRESULT.spec, action: 'plan' as const },
    };
    mockFindTFResults.mockResolvedValue([FAKE_TFRESULT, second]);

    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('fail'),
    );

    const tfLines = errorLines.filter((l) => l.includes('TFResult/'));
    expect(tfLines.length).toBe(2);
    expect(tfLines.some((l) => l.includes('my-group-apply'))).toBe(true);
    expect(tfLines.some((l) => l.includes('my-group-plan'))).toBe(true);
  });

  it('reports "none found" when TFResults list is empty', async () => {
    mockFindTFResults.mockResolvedValue([]);

    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('fail'),
    );

    expect(errorLines.some((l) => l.includes('none found'))).toBe(true);
  });

  it('truncates TFResult output that exceeds the line limit', async () => {
    const manyLines = Array.from({ length: 120 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    mockFindTFResults.mockResolvedValue([
      {
        ...FAKE_TFRESULT,
        spec: { ...FAKE_TFRESULT.spec, result: manyLines },
      },
    ]);

    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('fail'),
    );

    expect(errorLines.some((l) => l.includes('lines omitted'))).toBe(true);
  });

  it('reports TFResult lookup failure gracefully', async () => {
    mockFindTFResults.mockRejectedValue(
      Object.assign(new Error('cluster unreachable'), { statusCode: 503 }),
    );

    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('fail'),
    );

    expect(errorLines.some((l) => l.includes('lookup failed'))).toBe(true);
  });

  it('emits BEGIN/END and original failure when rendered resource is unreadable', async () => {
    mockGetPrimary.mockRejectedValue(new Error('file not found'));

    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      new Error('outer cause'),
    );

    expect(errorLines.some((l) => l.includes(E2E_DIAGNOSTIC_BEGIN))).toBe(true);
    expect(errorLines.some((l) => l.includes(E2E_DIAGNOSTIC_END))).toBe(true);
    expect(
      errorLines.some((l) => l.includes('Failed to read rendered resource')),
    ).toBe(true);
    expect(errorLines.some((l) => l.includes('outer cause'))).toBe(true);
  });

  it('does not produce [object Object] for plain-object errors', async () => {
    const k8sStyleError = {
      statusCode: 404,
      message: 'not found',
      body: { reason: 'NotFound' },
    };
    mockReadResource.mockRejectedValue(k8sStyleError);

    await logCrDiagnostics(
      buildMockProvider(),
      'default',
      FAKE_CR_PATH,
      k8sStyleError,
    );

    expect(errorLines.some((l) => l.includes('[object Object]'))).toBe(false);
    expect(errorLines.some((l) => l.includes('not found'))).toBe(true);
  });
});
