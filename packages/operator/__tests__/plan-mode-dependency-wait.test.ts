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

import {
  cancelDependencyWait,
  isWaitingForDependencies,
  waitForDependencies,
} from '../src/plan-mode/dependency-wait';

const ITEM_PATH = 'default/githubrepositoryfeatures/feature';

async function tick(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
}

describe('Plan mode dependency wait', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    cancelDependencyWait(ITEM_PATH);
    jest.useRealTimers();
  });

  it('requeues the CR once its dependencies are ready', async () => {
    const check = jest
      .fn()
      .mockResolvedValueOnce('waiting')
      .mockResolvedValueOnce('ready');
    const requeue = jest.fn();

    waitForDependencies(ITEM_PATH, check, requeue, 1000);

    await tick(1000);

    expect(check).toHaveBeenCalledTimes(1);
    expect(requeue).not.toHaveBeenCalled();
    expect(isWaitingForDependencies(ITEM_PATH)).toBe(true);

    await tick(1000);

    expect(requeue).toHaveBeenCalledTimes(1);
    expect(isWaitingForDependencies(ITEM_PATH)).toBe(false);

    await tick(5000);

    expect(check).toHaveBeenCalledTimes(2);
  });

  it('keeps waiting when a check fails', async () => {
    const check = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ready');
    const requeue = jest.fn();

    waitForDependencies(ITEM_PATH, check, requeue, 1000);

    await tick(2000);

    expect(requeue).toHaveBeenCalledTimes(1);
  });

  it('forgets a CR that is gone without requeueing it', async () => {
    const requeue = jest.fn();

    waitForDependencies(ITEM_PATH, async () => 'gone', requeue, 1000);

    await tick(1000);

    expect(requeue).not.toHaveBeenCalled();
    expect(isWaitingForDependencies(ITEM_PATH)).toBe(false);
  });

  it('stops checking when cancelled by a newer plan', async () => {
    const check = jest.fn(async () => 'ready' as const);
    const requeue = jest.fn();

    waitForDependencies(ITEM_PATH, check, requeue, 1000);

    cancelDependencyWait(ITEM_PATH);

    await tick(5000);

    expect(check).not.toHaveBeenCalled();
    expect(requeue).not.toHaveBeenCalled();
  });
});
