jest.mock('gh_provisioner', () => ({
  __esModule: true,
  default: { runGhProvisioner: jest.fn() },
}));

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
    silly: jest.fn(),
  },
}));

jest.mock('../src/status', () => ({
  updateTransition: jest.fn(),
}));

jest.mock('../src/processItemDLH', () => ({
  deadLetterHandler: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ghProvisioner from 'gh_provisioner';

import { OperationType, WorkItem, WorkStatus } from '../src/definitions';
import { needsDeletionBlocking } from '../src/dependants';
import { initPlanMode } from '../src/plan-mode/config';
import { planGithubOperation } from '../src/plan-mode/process-operation';
import { initProcessItemsSlots } from '../src/processItem.slot';

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-mode-blocked-'));

beforeAll(() => {
  initPlanMode({ flag: true, outputDir });
});

it('records a repository deletion blocked by its dependants as SKIPPED through the slot', async () => {
  const item = {
    kind: 'FirestartrGithubRepository',
    metadata: {
      name: 'repo',
      namespace: 'default',
      uid: 'repo-uid',
      deletionTimestamp: '2026-10-27T00:00:00Z',
      finalizers: ['firestartr.dev/foreground-deletion'],
    },
    spec: {},
  };
  const onBlocked = jest.fn();
  const handler: any = {
    itemPath: () => 'default/firestartrgithubrepositories/repo',
    needsBlocking: needsDeletionBlocking,
    getSlotInfo: () => ({ slotId: 0 }),
    recommendedTimeout: () => 1000,
    resolveReferences: jest.fn(async () => ({})),
    resolveOwnOutputs: jest.fn(async () => null),
    success: jest.fn(),
    error: jest.fn(),
  };
  const workItem = {
    item,
    operation: OperationType.MARKED_TO_DELETION,
    workStatus: WorkStatus.PENDING,
    onDelete: () => {},
    getItem: async () => item,
    process: planGithubOperation,
    handler,
  } as any as WorkItem;

  const [slot] = [...initProcessItemsSlots(1, false, onBlocked).getIdleSlots()];
  await slot.runWorkItem(workItem);

  expect(onBlocked).not.toHaveBeenCalled();
  expect((ghProvisioner as any).runGhProvisioner).not.toHaveBeenCalled();

  const json = JSON.parse(
    fs.readFileSync(
      path.join(outputDir, 'FirestartrGithubRepository', 'repo.json'),
      'utf8',
    ),
  );
  expect(json.result).toMatchObject({
    status: 'SKIPPED',
    reason: 'deletion waits for its dependants (foreground-deletion finalizer)',
  });
  expect(handler.success).toHaveBeenCalled();
});
