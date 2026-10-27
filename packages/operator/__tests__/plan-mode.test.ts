jest.mock('terraform_provisioner', () => ({
  __esModule: true,
  runTerraformProvisioner: jest.fn(),
}));

jest.mock('gh_provisioner', () => ({
  __esModule: true,
  default: { runGhProvisioner: jest.fn() },
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
  },
}));

jest.mock('../src/plan-mode/write-gateway', () => {
  const actual = jest.requireActual('../src/plan-mode/write-gateway');
  return {
    __esModule: true,
    ...actual,
    assertWriteAllowed: jest.fn(actual.assertWriteAllowed),
  };
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ghProvisioner from 'gh_provisioner';
import { runTerraformProvisioner } from 'terraform_provisioner';

import { OperationType } from '../src/definitions';
import log from '../src/logger';
import { initPlanMode } from '../src/plan-mode/config';
import {
  assertWriteAllowed,
  PlanModeWriteError,
} from '../src/plan-mode/write-gateway';
import {
  planGithubOperation,
  planTerraformOperation,
  planUnsupportedOperation,
} from '../src/plan-mode/process-operation';
import { resolve, ResolverError } from '../src/resolver';
import {
  addDestroyCommitStatus,
  addPlanStatusCheck,
  deleteSecret,
  unsetFinalizer,
  upsertFinalizer,
  upsertResult,
  writeConnectionSecret,
  writePlanInGithubPR,
  writeStatus,
} from '../src/ctl';
import { GHCheckRun } from '../src/user-feedback-ops/gh-checkrun';
import { TFCheckRun } from '../src/user-feedback-ops/tf-checkrun';
import {
  tryPublishApply,
  tryPublishDestroy,
  tryPublishError,
} from '../src/user-feedback-ops/user-feedback-ops';

const mockTf = runTerraformProvisioner as jest.Mock;
const mockGh = (ghProvisioner as any).runGhProvisioner as jest.Mock;
const mockGateway = assertWriteAllowed as jest.Mock;

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-mode-'));

const PLAN_TEXT = 'Plan: 0 to add, 2 to change, 0 to destroy.\n';
const PLAN_JSON = {
  resource_changes: [
    { change: { actions: ['update'] } },
    { change: { actions: ['update'] } },
  ],
};
const ARTIFACT = {
  text: PLAN_TEXT,
  json: PLAN_JSON,
  summary: { add: 0, change: 2, destroy: 0 },
};

beforeAll(() => {
  initPlanMode({ flag: true, outputDir });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTf.mockImplementation(async (_ctx: any, command: string) =>
    command === 'tear-up-project' ? { tornUp: true } : ARTIFACT,
  );
  mockGh.mockResolvedValue(ARTIFACT);
});

function tfItem(annotations: any = {}, metadata: any = {}) {
  return {
    kind: 'FirestartrTerraformWorkspace',
    metadata: {
      name: 'ws',
      namespace: 'default',
      generation: 1,
      annotations: { 'firestartr.dev/policy': 'full-control', ...annotations },
      ...metadata,
    },
    spec: {
      source: 'Inline',
      module: 'resource "test" {}',
      values: '{"key": "value"}',
      context: { providers: [], backend: { ref: { name: 'backend' } } },
      firestartr: { tfStateKey: 'ws-key' },
      references: [],
    },
  };
}

function ghItem(metadata: any = {}) {
  return {
    kind: 'FirestartrGithubRepository',
    metadata: {
      name: 'repo',
      namespace: 'default',
      annotations: { 'firestartr.dev/last-state-pr': 'org/repo#1' },
      ...metadata,
    },
    spec: {},
  };
}

function handler(overrides: any = {}) {
  return {
    resolveReferences: jest.fn(async () => ({
      'FirestartrProviderConfig-backend': {
        cr: {
          metadata: { name: 'backend' },
          spec: {
            type: 's3',
            config: '{}',
            inline: '',
            source: 'test',
            version: '1.0',
          },
        },
      },
    })),
    resolveOwnOutputs: jest.fn(async () => null),
    getSlotInfo: () => ({ slotId: 0 }),
    recommendedTimeout: () => 1000,
    success: jest.fn(),
    error: jest.fn(),
    ...overrides,
  };
}

async function drain(gen: AsyncGenerator<any>) {
  const transitions: any[] = [];
  for await (const t of gen) transitions.push(t);
  return transitions;
}

function readArtifacts(kind: string, name: string) {
  const base = path.join(outputDir, kind, name);
  return {
    md: fs.readFileSync(`${base}.md`, 'utf-8'),
    json: JSON.parse(fs.readFileSync(`${base}.json`, 'utf-8')),
  };
}

function tfCommands() {
  return mockTf.mock.calls.map((call: any[]) => call[1]);
}

describe('Plan mode: Terraform workspaces', () => {
  it.each([
    [OperationType.CREATED, 'plan-artifact'],
    [OperationType.UPDATED, 'plan-artifact'],
    [OperationType.MARKED_TO_DELETION, 'plan-destroy-artifact'],
  ])('plans %s as %s and writes both artifacts', async (op, command) => {
    const h = handler();

    const transitions = await drain(planTerraformOperation(tfItem(), op, h));

    expect(transitions).toEqual([]);
    expect(tfCommands()).toEqual([command, 'tear-up-project']);
    expect(tfCommands()).not.toContain('apply');
    expect(tfCommands()).not.toContain('destroy');

    const { md, json } = readArtifacts('FirestartrTerraformWorkspace', 'ws');
    expect(md).toMatch(/^# FirestartrTerraformWorkspace\/ws\n/);
    expect(md).toContain(`- Operation: ${op}   Policy: full-control   Planned at: `);
    expect(md).toContain('Lock: none');
    expect(md).toContain('- Result: ~2 change, +0 add, -0 destroy');
    expect(md).toContain(`## Plan\n\`\`\`text\n${PLAN_TEXT.trimEnd()}\n\`\`\`\n`);
    expect(json).toMatchObject({
      kind: 'FirestartrTerraformWorkspace',
      name: 'ws',
      operation: op,
      policy: 'full-control',
      lock: 'none',
      result: { status: 'PLANNED', add: 0, change: 2, destroy: 0 },
      plan: PLAN_JSON,
    });
    expect(h.success).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^PLAN FirestartrTerraformWorkspace/ws ${op}: \\+0 ~2 -0 \\(.*ws\\.md\\)$`),
      ),
    );
  });

  it('records NOTHING without running Terraform', async () => {
    await drain(planTerraformOperation(tfItem(), OperationType.NOTHING, handler()));

    expect(mockTf).not.toHaveBeenCalled();
    const { md, json } = readArtifacts('FirestartrTerraformWorkspace', 'ws');
    expect(md).toContain('- Result: NOTHING');
    expect(md).not.toContain('## Plan');
    expect(json.result.status).toBe('NOTHING');
    expect(json.plan).toBeNull();
  });

  it('records a SKIPPED artifact when the policy blocks the operation', async () => {
    const item = tfItem({ 'firestartr.dev/policy': 'create-only' }, {
      deletionTimestamp: '2026-01-01T00:00:00Z',
    });

    await drain(
      planTerraformOperation(item, OperationType.MARKED_TO_DELETION, handler()),
    );

    expect(mockTf).not.toHaveBeenCalled();
    const { md, json } = readArtifacts('FirestartrTerraformWorkspace', 'ws');
    expect(md).toContain(
      '- Result: SKIPPED (policy create-only blocks MARKED_TO_DELETION)',
    );
    expect(json.result).toMatchObject({
      status: 'SKIPPED',
      reason: 'policy create-only blocks MARKED_TO_DELETION',
    });
  });

  it('records a SKIPPED artifact when sync-policy and policy are incompatible', async () => {
    const item = tfItem({
      'firestartr.dev/policy': 'apply',
      'firestartr.dev/sync-policy': 'full-control',
    });

    await drain(planTerraformOperation(item, OperationType.SYNC, handler()));

    expect(mockTf).not.toHaveBeenCalled();
    expect(readArtifacts('FirestartrTerraformWorkspace', 'ws').json.result.reason).toBe(
      'sync-policy full-control is not compatible with policy apply',
    );
  });

  it('plans CRs under the observe policy, like the live operator', async () => {
    await drain(
      planTerraformOperation(
        tfItem({ 'firestartr.dev/policy': 'observe' }),
        OperationType.UPDATED,
        handler(),
      ),
    );

    expect(tfCommands()[0]).toBe('plan-artifact');
  });

  it('records SKIPPED naming the parent when its outputs are missing', async () => {
    const h = handler({
      resolveReferences: jest.fn(async () => {
        throw new ResolverError('FirestartrTerraformWorkspace-parent-ws');
      }),
    });

    await drain(planTerraformOperation(tfItem(), OperationType.CREATED, h));

    expect(mockTf).not.toHaveBeenCalled();
    expect(readArtifacts('FirestartrTerraformWorkspace', 'ws').md).toContain(
      '- Result: SKIPPED (parent FirestartrTerraformWorkspace/parent-ws not provisioned)',
    );
    expect(h.error).not.toHaveBeenCalled();
  });

  it('records SKIPPED when the parent lookup is a 404', async () => {
    const h = handler({
      resolveReferences: jest.fn(async () => {
        throw new ResolverError(
          'FirestartrTerraformWorkspace-parent-ws',
          'lookup failed',
          new Error('Error on getItemByItemPath: default/x/parent-ws: Not Found'),
        );
      }),
    });

    await drain(planTerraformOperation(tfItem(), OperationType.CREATED, h));

    expect(readArtifacts('FirestartrTerraformWorkspace', 'ws').json.result.status).toBe(
      'SKIPPED',
    );
    expect(h.error).not.toHaveBeenCalled();
  });

  it('records ERROR and retries when the parent lookup fails otherwise', async () => {
    const h = handler({
      resolveReferences: jest.fn(async () => {
        throw new ResolverError(
          'FirestartrTerraformWorkspace-parent-ws',
          "depends on 'FirestartrTerraformWorkspace/parent-ws' but looking it up failed: Gateway Timeout",
          new Error('Error on getItemByItemPath: default/x/parent-ws: Gateway Timeout'),
        );
      }),
    });

    await drain(planTerraformOperation(tfItem(), OperationType.CREATED, h));

    const { json } = readArtifacts('FirestartrTerraformWorkspace', 'ws');
    expect(json.result.status).toBe('ERROR');
    expect(json.result.reason).toContain('Gateway Timeout');
    expect(h.error).toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
  });

  it('records an ERROR artifact and schedules an in-memory retry on failure', async () => {
    mockTf.mockImplementation(async (_ctx: any, command: string) => {
      if (command === 'tear-up-project') return { tornUp: true };
      throw new Error('provider exploded');
    });
    const h = handler();

    await drain(planTerraformOperation(tfItem(), OperationType.UPDATED, h));

    const { md, json } = readArtifacts('FirestartrTerraformWorkspace', 'ws');
    expect(md).toContain('- Result: ERROR provider exploded');
    expect(json.result).toMatchObject({ status: 'ERROR' });
    expect(h.error).toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
  });

  it('schedules the retry before propagating an artifact write failure', async () => {
    const h = handler();
    const failure = new Error('ENOSPC: no space left on device');
    const mkdir = jest.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(failure);

    await expect(
      drain(planTerraformOperation(tfItem(), OperationType.UPDATED, h)),
    ).rejects.toBe(failure);

    mkdir.mockRestore();
    expect(h.error).toHaveBeenCalledTimes(1);
    expect(h.success).not.toHaveBeenCalled();
  });

  it('overwrites the previous artifacts of the same CR', async () => {
    await drain(planTerraformOperation(tfItem(), OperationType.UPDATED, handler()));
    await drain(planTerraformOperation(tfItem(), OperationType.NOTHING, handler()));

    expect(fs.readdirSync(path.join(outputDir, 'FirestartrTerraformWorkspace')).sort()).toEqual(
      ['ws.json', 'ws.md'],
    );
    expect(readArtifacts('FirestartrTerraformWorkspace', 'ws').json.result.status).toBe(
      'NOTHING',
    );
  });

  it('writes artifacts owner-only, even over a leftover world-readable temp file', async () => {
    const dir = path.join(outputDir, 'FirestartrTerraformWorkspace');
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of ['md', 'json']) {
      fs.writeFileSync(path.join(dir, `ws.${ext}.tmp`), 'stale', { mode: 0o644 });
    }

    await drain(planTerraformOperation(tfItem(), OperationType.UPDATED, handler()));

    for (const ext of ['md', 'json']) {
      expect(fs.statSync(path.join(dir, `ws.${ext}`)).mode & 0o777).toBe(0o600);
      expect(fs.existsSync(path.join(dir, `ws.${ext}.tmp`))).toBe(false);
    }
  });
});

describe('Plan mode: GitHub kinds', () => {
  it('plans with the provisioner plan operation, never apply', async () => {
    await drain(planGithubOperation(ghItem(), OperationType.UPDATED, handler()));

    expect(mockGh).toHaveBeenCalledTimes(1);
    const opts = mockGh.mock.calls[0][1];
    expect(opts).toMatchObject({ plan: true, planArtifact: true });
    expect(opts).not.toHaveProperty('create');
    expect(opts).not.toHaveProperty('update');
    expect(opts).not.toHaveProperty('delete');
    expect(readArtifacts('FirestartrGithubRepository', 'repo').md).toContain(
      '- Result: ~2 change, +0 add, -0 destroy',
    );
  });

  it('plans a destroy for CRs marked to deletion', async () => {
    await drain(
      planGithubOperation(ghItem(), OperationType.MARKED_TO_DELETION, handler()),
    );

    expect(mockGh.mock.calls[0][1]).toMatchObject({
      planDestroy: true,
      planArtifact: true,
    });
    expect(mockGh.mock.calls[0][1]).not.toHaveProperty('delete');
  });

  it('records SKIPPED for a CR the live operator would reimport', async () => {
    const item = ghItem({
      annotations: {
        'firestartr.dev/import': 'true',
        'firestartr.dev/needs-re-import': 'true',
      },
    });

    await drain(planGithubOperation(item, OperationType.UPDATED, handler()));

    expect(mockGh).not.toHaveBeenCalled();
    expect(readArtifacts('FirestartrGithubRepository', 'repo').json.result).toMatchObject({
      status: 'SKIPPED',
      reason: 'reimport cannot be previewed without resetting state',
    });
  });

  it.each([
    ['unprovisioned', { status: { conditions: [{ type: 'PROVISIONED', status: 'False' }] } }, 'SKIPPED'],
    ['provisioned', { status: { conditions: [{ type: 'PROVISIONED', status: 'True' }] } }, 'PLANNED'],
  ])(
    'plans a feature whose needsSecret:false parent is %s as %s',
    async (_label, parentStatus, status) => {
      const parent = {
        kind: 'FirestartrGithubRepository',
        metadata: { name: 'repo', namespace: 'default' },
        spec: {},
        ...parentStatus,
      };
      const feature = {
        kind: 'FirestartrGithubRepositoryFeature',
        metadata: { name: 'feat', namespace: 'default' },
        spec: {
          repositoryTarget: {
            ref: { kind: 'FirestartrGithubRepository', name: 'repo', needsSecret: false },
          },
        },
      };
      const getSecret = jest.fn();
      const h = handler({
        resolveReferences: () => resolve(feature, async () => parent, getSecret),
      });

      await drain(planGithubOperation(feature, OperationType.CREATED, h));

      expect(getSecret).not.toHaveBeenCalled();
      const { json } = readArtifacts('FirestartrGithubRepositoryFeature', 'feat');
      expect(json.result.status).toBe(status);
      if (status === 'SKIPPED') {
        expect(mockGh).not.toHaveBeenCalled();
        expect(json.result.reason).toBe('parent FirestartrGithubRepository/repo not provisioned');
      }
    },
  );

  it('records NOTHING without running the provisioner', async () => {
    await drain(planGithubOperation(ghItem(), OperationType.NOTHING, handler()));

    expect(mockGh).not.toHaveBeenCalled();
    expect(readArtifacts('FirestartrGithubRepository', 'repo').json.result.status).toBe(
      'NOTHING',
    );
  });
});

describe('Plan mode: kinds without plan support', () => {
  it('records a SKIPPED artifact', async () => {
    const item = { kind: 'FirestartrDummyA', metadata: { name: 'd', namespace: 'default' } };

    await drain(planUnsupportedOperation(item, OperationType.CREATED, handler()));

    expect(readArtifacts('FirestartrDummyA', 'd').md).toContain(
      '- Result: SKIPPED (kind FirestartrDummyA has no plan support)',
    );
  });
});

describe('Plan mode: read-only guarantee', () => {
  it('plans without a single write through the gateway', async () => {
    await drain(planTerraformOperation(tfItem(), OperationType.UPDATED, handler()));
    await drain(planGithubOperation(ghItem(), OperationType.CREATED, handler()));

    expect(mockGateway).not.toHaveBeenCalled();
  });

  const item = ghItem();

  it.each([
    ['status', () => writeStatus('githubrepositories', 'default', item)],
    ['finalizer', () => upsertFinalizer('githubrepositories', 'default', item, 'f')],
    ['finalizer removal', () => unsetFinalizer('githubrepositories', 'default', item, 'f')],
    ['TFResult', () => upsertResult('default', item, 'out', 0)],
    ['connection secret', () => writeConnectionSecret(item, {})],
    ['secret deletion', () => deleteSecret('s', 'default')],
    ['destroy commit status', () => addDestroyCommitStatus(item, 'success')],
    ['plan check run', () => addPlanStatusCheck('org/repo#1', 'summary')],
    ['PR plan comment', () => writePlanInGithubPR('https://github.com/o/r/pull/1', 'plan')],
    ['GitHub check run', () => GHCheckRun('apply', item)],
    ['Terraform check run', () => TFCheckRun('apply', item)],
    ['apply PR comment', () => tryPublishApply(item, 'out')],
    ['destroy PR comment', () => tryPublishDestroy(item, 'out')],
    ['error PR comment', () => tryPublishError(item, 'reason', 'msg')],
  ])('refuses the %s write with PlanModeWriteError', async (_name, write) => {
    await expect(Promise.resolve().then(write)).rejects.toBeInstanceOf(
      PlanModeWriteError,
    );
  });
});
