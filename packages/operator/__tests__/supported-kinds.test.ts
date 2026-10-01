jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/informer', () => ({
  observeKind: jest.fn(() => new Promise(() => undefined)),
}));

jest.mock('../src/metricsServer', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../src/tfm_mirrors', () => ({
  configureTFMMirrors: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('github', () => ({
  __esModule: true,
  default: { createProfile: jest.fn() },
}));

import { filterImplementedKinds, runOperator } from '..';
import { observeKind } from '../src/informer';
import log from '../src/logger';
import metricsServer from '../src/metricsServer';

describe('operator kind configuration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps implemented kinds and warns about configured kinds without implementations', () => {
    expect(
      filterImplementedKinds(['githubgroups', 'futurekind', 'fsdummiesa']),
    ).toEqual(['githubgroups', 'fsdummiesa']);
    expect(log.warn).toHaveBeenCalledWith(
      "Ignoring configured kind 'futurekind': no implementation found",
    );
  });

  it('starts metrics and observers only for implemented configured kinds', async () => {
    runOperator({
      ignoreLease: true,
      dummyExec: false,
      namespace: 'default',
      kindList: ['githubgroups', 'futurekind', 'fsdummiesa'],
      withMetrics: true,
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(metricsServer).toHaveBeenCalledWith(
      ['githubgroups', 'fsdummiesa'],
      'default',
    );
    expect(
      (observeKind as jest.Mock).mock.calls.map(([kind]) => kind),
    ).toEqual(['githubgroups', 'fsdummiesa']);
  });
});
