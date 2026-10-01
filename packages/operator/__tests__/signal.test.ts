jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import { initSignalsHandler } from '../src/signals';

describe('initSignalsHandler', () => {
  let originalProcessOn: typeof process.on;
  let signalHandlers: Map<string, Function>;

  beforeEach(() => {
    originalProcessOn = process.on;
    signalHandlers = new Map();
    process.on = jest.fn((signal: string, handler: Function) => {
      signalHandlers.set(signal, handler);
      return process;
    }) as any;
  });

  afterEach(() => {
    process.on = originalProcessOn;
  });

  it('should register handlers for all provided signals', () => {
    const mapper = new Map<string, () => void>();
    mapper.set('SIGTERM', jest.fn());
    mapper.set('SIGINT', jest.fn());

    initSignalsHandler(mapper);

    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('should invoke the callback when signal is received', async () => {
    const callback = jest.fn();
    const mapper = new Map<string, () => void>();
    mapper.set('SIGTERM', callback);

    initSignalsHandler(mapper);
    await signalHandlers.get('SIGTERM')!();

    expect(callback).toHaveBeenCalled();
  });

  it('should not throw when callback throws', async () => {
    const callback = jest.fn(() => {
      throw new Error('fail');
    });
    const mapper = new Map<string, () => void>();
    mapper.set('SIGTERM', callback);

    initSignalsHandler(mapper);

    await expect(signalHandlers.get('SIGTERM')!()).resolves.toBeUndefined();
  });
});
