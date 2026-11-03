// Startup wiring test for the diagnostic flight recorder: `runOperator` must
// start the writer before any work arrives, using the queue snapshot seam and
// the processor's slot capacity.

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../src/processItem.diagnostic', () => ({
  startDiagnosticFile: jest.fn(() => true),
}));

jest.mock('../src/processItem', () => ({
  processItem: jest.fn(),
  getMaxSlots: jest.fn(() => 3),
  getOperatorQueueSnapshot: jest.fn(() => ({
    total: 0,
    pending: 0,
    processing: 0,
    finished: 0,
    blocked: 0,
    deadLetter: 0,
    slots: {},
  })),
  getQueueMetrics: jest.fn(),
}));

jest.mock('../src/informer', () => ({
  observeKind: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/tfm_mirrors', () => ({
  configureTFMMirrors: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/activity-log', () => ({
  initActivityLog: jest.fn(),
  logActivity: jest.fn(),
}));

jest.mock('github', () => ({
  __esModule: true,
  default: {
    createProfile: jest.fn(),
    withProfile: jest.fn(),
  },
}));

jest.mock('../src/metricsServer', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../src/crdMonitor', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../src/leader_election', () => ({
  acquireLease: jest.fn(),
}));

jest.mock('../src/status', () => ({
  isKubernetesNotFoundError: jest.fn(() => false),
}));

jest.mock('../src/execTfCmd', () => ({
  execTfCommand: jest.fn(),
}));

jest.mock('../src/pull-request-plan', () => ({
  pullRequestPlan: jest.fn(),
}));

jest.mock('../src/gh/process-operation', () => ({
  processOperation: jest.fn(),
}));

jest.mock('../src/tfworkspaces/process-operation', () => ({
  processOperation: jest.fn(),
}));

import { runOperator } from '../index';
import { startDiagnosticFile } from '../src/processItem.diagnostic';
import { getMaxSlots, getOperatorQueueSnapshot } from '../src/processItem';

describe('runOperator diagnostic startup', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts the diagnostic writer at startup with the queue snapshot seam', async () => {
    runOperator({
      ignoreLease: true,
      namespace: 'default',
      kindList: [],
      withMetrics: false,
    });

    // Let the deferred operator startup settle.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(startDiagnosticFile).toHaveBeenCalledTimes(1);
    expect(startDiagnosticFile).toHaveBeenCalledWith(
      getOperatorQueueSnapshot,
      getMaxSlots(),
    );
  });
});
