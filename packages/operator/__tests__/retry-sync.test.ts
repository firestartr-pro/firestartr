jest.mock('terraform_provisioner', () => ({
  __esModule: true,
  runTerraformProvisioner: jest.fn(),
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/ctl', () => ({
  __esModule: true,
  addPlanStatusCheck: jest.fn(async () => undefined),
  getItemByItemPath: jest.fn(),
  getSecret: jest.fn(),
}));

jest.mock('../src/user-feedback-ops/user-feedback-ops', () => ({
  __esModule: true,
  tryCreateErrorSummary: jest.fn((_title: string, msg: string) => msg),
  tryPublishApply: jest.fn(),
  tryPublishDestroy: jest.fn(),
  tryPublishError: jest.fn(),
}));

jest.mock('../src/utils', () => ({
  __esModule: true,
  extractErrorDetails: jest.fn((e: any) => ({
    output: e?.message || String(e),
  })),
  replaceConfigSecrets: jest.fn((x: any) => x),
  replaceInlineSecrets: jest.fn((x: any) => x),
}));

jest.mock('catalog_common', () => ({
  __esModule: true,
  default: {
    environment: {
      getFromEnvironment: jest.fn(() => '1'),
    },
    types: {
      envVars: {
        operatorNumberOfMaxSlots: 'OPERATOR_NUMBER_OF_MAX_SLOTS',
        operatorDeploymentName: 'OPERATOR_DEPLOYMENT_NAME',
      },
    },
    policies: {
      getPolicyByName: jest.fn(() => ({
        allowedOps: ['SYNC', 'RETRY', 'RETRY_SYNC'],
      })),
      policiesAreCompatible: jest.fn(() => true),
      FIRESTARTR_POLICIES: [
        { name: 'full-control', allowedOps: ['SYNC', 'RETRY', 'RETRY_SYNC'] },
        { name: 'observe-only', allowedOps: ['SYNC'] },
      ],
    },
  },
}));

import { runTerraformProvisioner } from 'terraform_provisioner';
import { OperationType, WorkItemHandler } from '../src/informer';
import { SYNC_DEFAULT_ERROR_MESSAGE } from '../src/utils/operationErrorMessages';

const mockTfPlan = {
  summary: {
    hasChanges: () => false,
    toString: () => 'No changes',
  },
  detailedBriefing: {},
};

const mockDeps = {
  'FirestartrProviderConfig-kubernetes-backend': {
    cr: {
      spec: {
        type: 'kubernetes',
        version: '3.0.1',
        source: 'hashicorp/kubernetes',
        config: '{}',
        inline: '',
      },
    },
  },
};

const mockHandler: WorkItemHandler = {
  finalize: async () => ({}),
  pluralKind: 'tfworkspaces',
  informPlan: async () => {},
  writeTerraformOutputInTfResult: async () => ({}),
  writeConnectionSecret: async () => {},
  resolveReferences: async () => mockDeps,
  resolveOwnOutputs: async () => undefined,
  deleteSecret: async () => null,
  itemPath: () => 'tfworkspaces/test-workspace',
  error: async () => {},
  success: async () => {},
  recommendedTimeout: () => 1000,
  getSlotInfo: () => ({ slotId: 0 }),
  needsBlocking: () => false,
} as any;

function makeItem(
  kind: string,
  name: string,
  annotations: Record<string, string> = {},
  spec: Record<string, any> = {},
) {
  return {
    kind,
    metadata: {
      name,
      namespace: 'default',
      uid: 'test-uid',
      annotations,
    },
    spec: {
      source: 'Inline',
      module: {},
      values: '{}',
      firestartr: { tfStateKey: `test-${name}-key` },
      references: [],
      context: {
        providers: [],
        backend: {
          ref: {
            kind: 'FirestartrProviderConfig',
            name: 'kubernetes-backend',
          },
        },
      },
      ...spec,
    },
    status: {
      conditions: [],
    },
  };
}

async function collectTransitions(
  gen: AsyncGenerator<any, void, unknown>,
): Promise<any[]> {
  const transitions: any[] = [];
  for await (const t of gen) {
    transitions.push(t);
  }
  return transitions;
}

import { retry, sync, doPlanJSONFormat } from '../src/tfworkspaces/process-operation';
import { retry as ghRetry, sync as ghSync } from '../src/gh/process-operation';
import { retryOpForReason } from '../src/definitions';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('retryOpForReason — error reason to operation mapping', () => {
  it('maps SYNC reason to RETRY_SYNC', () => {
    expect(retryOpForReason('SYNC')).toBe(OperationType.RETRY_SYNC);
  });

  it('maps RETRY_SYNC reason to RETRY_SYNC', () => {
    expect(retryOpForReason('RETRY_SYNC')).toBe(OperationType.RETRY_SYNC);
  });

  it('maps undefined to RETRY', () => {
    expect(retryOpForReason(undefined)).toBe(OperationType.RETRY);
  });

  it('maps non-sync error reasons to RETRY', () => {
    expect(retryOpForReason('APPLY_ERROR')).toBe(OperationType.RETRY);
    expect(retryOpForReason('PLAN_ERROR')).toBe(OperationType.RETRY);
    expect(retryOpForReason('DESTROY_ERROR')).toBe(OperationType.RETRY);
  });

  it('maps empty string to RETRY', () => {
    expect(retryOpForReason('')).toBe(OperationType.RETRY);
  });
});

describe('tfworkspaces retry() routing — RETRY_SYNC vs RETRY', () => {
  it('routes RETRY_SYNC to sync flow (plan-only), not doApply', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue(mockTfPlan);

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws', {
      'firestartr.dev/policy': 'observe',
      'firestartr.dev/sync-policy': 'observe',
    });

    const transitions = await collectTransitions(
      retry(item, OperationType.RETRY_SYNC, mockHandler),
    );

    // RETRY_SYNC should route through sync -> doPlanJSONFormat, not doApply
    // doPlanJSONFormat yields: ERROR=False, PROVISIONED=False, PLANNING=True, PROVISIONED (hasChanges check), OUT_OF_SYNC, LAST_PLAN_DETAILS, PLANNING=False
    const types = transitions.map((t) => t.type);
    expect(types).toContain('PLANNING');
    expect(types).toContain('OUT_OF_SYNC');
    expect(types).toContain('LAST_PLAN_DETAILS');
    // Should NOT have PROVISIONING or DELETED (from doApply/markedToDeletion)
    expect(types).not.toContain('PROVISIONING');
    expect(types).not.toContain('DELETED');
  });

  it('routes RETRY (non-sync) to doApply', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue(mockTfPlan);

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws', {
      'firestartr.dev/policy': 'full-control',
    });

    const transitions = await collectTransitions(
      retry(item, OperationType.RETRY, mockHandler),
    );

    const types = transitions.map((t) => t.type);
    expect(types).not.toContain('SYNCHRONIZED');
  });

  it('routes RETRY_SYNC with observe policy through doPlanJSONFormat (no apply attempt)', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue(mockTfPlan);

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws', {
      'firestartr.dev/policy': 'full-control',
      'firestartr.dev/sync-policy': 'observe',
    });

    const transitions = await collectTransitions(
      retry(item, OperationType.RETRY_SYNC, mockHandler),
    );

    const types = transitions.map((t) => t.type);
    expect(types).toContain('PLANNING');
    expect(types).toContain('LAST_PLAN_DETAILS');
  });
});

describe('tfworkspaces doPlanJSONFormat — SYNC error surfacing', () => {
  it('yields ERROR=True with SYNC_DEFAULT_ERROR_MESSAGE on failure for SYNC operation', async () => {
    (runTerraformProvisioner as jest.Mock).mockRejectedValue(
      new Error('plan failed'),
    );

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws');

    const transitions = await collectTransitions(
      doPlanJSONFormat(item, OperationType.SYNC, mockHandler),
    );

    const errorTransitions = transitions.filter(
      (t) => t.type === 'ERROR' && t.status === 'True',
    );
    expect(errorTransitions.length).toBeGreaterThanOrEqual(1);
    expect(errorTransitions[0].reason).toBe(OperationType.SYNC);
    expect(errorTransitions[0].message).toBe(SYNC_DEFAULT_ERROR_MESSAGE);
  });

  it('yields ERROR=True with SYNC_DEFAULT_ERROR_MESSAGE on failure for RETRY_SYNC operation', async () => {
    (runTerraformProvisioner as jest.Mock).mockRejectedValue(
      new Error('retry sync failed'),
    );

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws');

    const transitions = await collectTransitions(
      doPlanJSONFormat(item, OperationType.RETRY_SYNC, mockHandler),
    );

    const errorTransitions = transitions.filter(
      (t) => t.type === 'ERROR' && t.status === 'True',
    );
    expect(errorTransitions.length).toBeGreaterThanOrEqual(1);
    expect(errorTransitions[0].reason).toBe(OperationType.RETRY_SYNC);
    expect(errorTransitions[0].message).toBe(SYNC_DEFAULT_ERROR_MESSAGE);
  });

  it('yields SYNCHRONIZED=False with SYNC_DEFAULT_ERROR_MESSAGE on sync failure', async () => {
    (runTerraformProvisioner as jest.Mock).mockRejectedValue(
      new Error('plan failed'),
    );

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws');

    const transitions = await collectTransitions(
      doPlanJSONFormat(item, OperationType.SYNC, mockHandler),
    );

    const syncTransitions = transitions.filter(
      (t) => t.type === 'SYNCHRONIZED' && t.status === 'False',
    );
    expect(syncTransitions.length).toBeGreaterThanOrEqual(1);
    expect(syncTransitions[0].reason).toBe(OperationType.SYNC);
    expect(syncTransitions[0].message).toBe(SYNC_DEFAULT_ERROR_MESSAGE);
  });

  it('does NOT surface SYNC_ERROR transitions for non-sync operations (PLAN_ERROR instead)', async () => {
    (runTerraformProvisioner as jest.Mock).mockRejectedValue(
      new Error('plan failed'),
    );

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws');

    const transitions = await collectTransitions(
      doPlanJSONFormat(item, OperationType.RETRY, mockHandler),
    );

    const syncErrorTransitions = transitions.filter(
      (t) => t.message === SYNC_DEFAULT_ERROR_MESSAGE,
    );
    expect(syncErrorTransitions.length).toBe(0);

    const errorTransitions = transitions.filter(
      (t) => t.type === 'ERROR' && t.status === 'True',
    );
    expect(errorTransitions.length).toBeGreaterThanOrEqual(1);
    expect(errorTransitions[0].message).not.toBe(SYNC_DEFAULT_ERROR_MESSAGE);
  });

  it('calls setResult("SYNC_SUCCESS") on success for SYNC operation', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue(mockTfPlan);

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws');

    let setResultCalledWith = '';
    await collectTransitions(
      doPlanJSONFormat(item, OperationType.SYNC, mockHandler, (r: string) => {
        setResultCalledWith = r;
      }),
    );

    expect(setResultCalledWith).toBe('SYNC_SUCCESS');
  });
});

describe('tfworkspaces sync() — observe vs apply policy routing', () => {
  it('calls doPlanJSONFormat (plan-only) for observe sync-policy', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue(mockTfPlan);

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws', {
      'firestartr.dev/policy': 'full-control',
      'firestartr.dev/sync-policy': 'observe',
    });

    const transitions = await collectTransitions(
      sync(item, OperationType.SYNC, mockHandler, 'observe', 'full-control'),
    );

    const types = transitions.map((t) => t.type);
    expect(types).toContain('LAST_PLAN_DETAILS');
    expect(types).not.toContain('PROVISIONING');
  });

  it('yields SYNCHRONIZED=True on SYNC_SUCCESS', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue(mockTfPlan);

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws', {
      'firestartr.dev/policy': 'full-control',
      'firestartr.dev/sync-policy': 'observe',
    });

    const transitions = await collectTransitions(
      sync(item, OperationType.SYNC, mockHandler, 'observe', 'full-control'),
    );

    const synced = transitions.filter(
      (t) => t.type === 'SYNCHRONIZED' && t.status === 'True',
    );
    expect(synced.length).toBe(1);
    expect(synced[0].reason).toBe(OperationType.SYNC);
  });

  it('yields SYNCHRONIZED=True on SYNC_SUCCESS for RETRY_SYNC', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue(mockTfPlan);

    const item = makeItem('FirestartrTerraformWorkspace', 'test-ws', {
      'firestartr.dev/policy': 'full-control',
      'firestartr.dev/sync-policy': 'observe',
    });

    const transitions = await collectTransitions(
      sync(item, OperationType.RETRY_SYNC, mockHandler, 'observe', 'full-control'),
    );

    const synced = transitions.filter(
      (t) => t.type === 'SYNCHRONIZED' && t.status === 'True',
    );
    expect(synced.length).toBe(1);
    expect(synced[0].reason).toBe(OperationType.RETRY_SYNC);
  });
});

describe('gh retry() routing — RETRY_SYNC vs RETRY', () => {
  it('routes RETRY_SYNC to sync flow, not doApply', async () => {
    const item = makeItem('FirestartrGithubRepository', 'test-repo');

    const transitions = await collectTransitions(
      ghRetry(item, OperationType.RETRY_SYNC, mockHandler),
    );

    const types = transitions.map((t) => t.type);
    expect(types).toContain('SYNCHRONIZED');
  });

  it('routes RETRY (non-sync) to doApply', async () => {
    (runTerraformProvisioner as jest.Mock).mockResolvedValue({});

    const item = makeItem('FirestartrGithubRepository', 'test-repo');

    const transitions = await collectTransitions(
      ghRetry(item, OperationType.RETRY, mockHandler),
    );

    const types = transitions.map((t) => t.type);
    expect(types).not.toContain('SYNCHRONIZED');
  });

  it('routes RETRY_SYNC through sync flow yielding SYNCHRONIZED status', async () => {
    const item = makeItem('FirestartrGithubRepository', 'test-repo');

    const transitions = await collectTransitions(
      ghSync(item, OperationType.RETRY_SYNC, mockHandler),
    );

    const syncTransitions = transitions.filter(
      (t) => t.type === 'SYNCHRONIZED',
    );
    expect(syncTransitions.length).toBeGreaterThanOrEqual(1);
    expect(syncTransitions[0].reason).toBe(OperationType.RETRY_SYNC);
  });
});
