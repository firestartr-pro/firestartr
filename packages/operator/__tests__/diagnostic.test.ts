jest.mock('fs', () => {
  const actual = jest.requireActual('fs');

  return {
    ...actual,
    writeFile: jest.fn(
      (_path: unknown, _data: unknown, cb: (err: unknown) => void) => cb(null),
    ),
  };
});

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import * as fs from 'fs';

import log from '../src/logger';
import { incrementDiagnosticErrorCount } from '../src/diagnosticErrors';
import {
  getDiagnosticIntervalSeconds,
  getDiagnosticTimer,
  startDiagnosticFile,
  stopDiagnosticFile,
} from '../src/processItem.diagnostic';
import type { DiagnosticQueueSnapshot } from '../src/processItem.diagnostic';

function emptySnapshot(): DiagnosticQueueSnapshot {
  return {
    total: 0,
    pending: 0,
    processing: 0,
    finished: 0,
    blocked: 0,
    deadLetter: 0,
    slots: {},
  };
}

function busySnapshot(): DiagnosticQueueSnapshot {
  return {
    total: 4,
    pending: 1,
    processing: 2,
    finished: 1,
    blocked: 1,
    deadLetter: 1,
    slots: {
      'slot-0': 'DummyCR/foo-1',
      'slot-1': 'DummyCR/foo-2',
    },
  };
}

/** Contents written by the most recent snapshot, or '' when none was written. */
function lastWrittenDocument(): string {
  const calls = (fs.writeFile as unknown as jest.Mock).mock.calls;
  return calls.length > 0 ? String(calls[calls.length - 1][1]) : '';
}

describe('getDiagnosticIntervalSeconds', () => {
  it('defaults to 30 seconds when the interval is not configured', () => {
    expect(getDiagnosticIntervalSeconds({})).toBe(30);
  });

  it('returns the configured interval in seconds', () => {
    expect(
      getDiagnosticIntervalSeconds({
        OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS: '45',
      }),
    ).toBe(45);
  });

  it('falls back to the default for unusable values', () => {
    for (const raw of ['', '   ', 'abc', '0', '-5', 'NaN']) {
      expect(
        getDiagnosticIntervalSeconds({
          OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS: raw,
        }),
      ).toBe(30);
    }
  });

  it('rejects intervals Node cannot represent instead of clamping to 1 ms', () => {
    // setTimeout/setInterval clamp any delay above 2^31-1 ms to 1 ms.
    expect(
      getDiagnosticIntervalSeconds({
        OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS: '2592000',
      }),
    ).toBe(30);
    expect(
      getDiagnosticIntervalSeconds({
        OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS: '2147484',
      }),
    ).toBe(30);
    expect(
      getDiagnosticIntervalSeconds({
        OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS: '2147483',
      }),
    ).toBe(2147483);
  });
});

describe('startDiagnosticFile', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (fs.writeFile as unknown as jest.Mock).mockReset();
    (fs.writeFile as unknown as jest.Mock).mockImplementation(
      ((_path: unknown, _data: unknown, cb: any) => cb(null)) as any,
    );
    delete (global as any).__crdMonitors;
    delete process.env.OPERATOR_KIND_LIST;
  });

  afterEach(() => {
    stopDiagnosticFile();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('does nothing when DISABLE_DIAGNOSTIC_FILE is set', async () => {
    const started = startDiagnosticFile(emptySnapshot, 1, {
      DISABLE_DIAGNOSTIC_FILE: '1',
    });

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(started).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(getDiagnosticTimer()).toBeUndefined();
    expect((log.info as jest.Mock).mock.calls.flat().join(' ')).toContain(
      'DISABLE_DIAGNOSTIC_FILE',
    );
  });

  it('writes the first snapshot right away, before any work item arrives', () => {
    const started = startDiagnosticFile(emptySnapshot, 2, {});

    expect(started).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/diagnostic',
      expect.stringContaining('queue:\n  total: 0\n'),
      expect.any(Function),
    );
  });

  it('writes again on the configured interval', async () => {
    startDiagnosticFile(emptySnapshot, 1, {
      OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS: '45',
    });

    await jest.advanceTimersByTimeAsync(44_999);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(45_000);
    expect(fs.writeFile).toHaveBeenCalledTimes(3);
  });

  it('defaults to a 30 second interval', async () => {
    startDiagnosticFile(emptySnapshot, 1, {});

    await jest.advanceTimersByTimeAsync(29_999);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('renders the documented snapshot from the injected queue source', () => {
    const source = jest.fn(() => busySnapshot());
    incrementDiagnosticErrorCount();
    process.env.OPERATOR_KIND_LIST = 'DummyCR,ClaimRelease';

    startDiagnosticFile(source, 3, {});

    expect(source).toHaveBeenCalledTimes(1);

    const document = lastWrittenDocument();

    expect(document).toContain('timestamp: "');
    expect(document).toContain('queue:\n');
    expect(document).toContain('  total: 4\n');
    expect(document).toContain('  pending: 1\n');
    expect(document).toContain('  processing: 2\n');
    expect(document).toContain('  finished: 1\n');
    expect(document).toContain('  blocked: 1\n');
    expect(document).toContain('  dead_letter: 1\n');
    expect(document).toContain('slots:\n  max: 3\n  active: 2\n');
    expect(document).toContain('    slot-0: "DummyCR/foo-1"\n');
    expect(document).toContain('    slot-1: "DummyCR/foo-2"\n');
    expect(document).toContain('    slot-2: null\n');
    expect(document).not.toContain('slot-3:');
    expect(document).toContain('semaphore:\n');
    expect(document).toContain('  peak: ');
    expect(document).toContain('  times_saturated: ');
    expect(document).toMatch(/errors:\n {2}total: \d+\n/);
    expect(document).toContain('crds:\n  observed:\n    - "DummyCR"\n');
  });

  it('logs a throwing snapshot source and retries on the next tick', async () => {
    const source = jest.fn(() => {
      throw new Error('snapshot seam exploded');
    });

    expect(() => startDiagnosticFile(source, 1, {})).not.toThrow();

    await jest.advanceTimersByTimeAsync(30_000);

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('snapshot seam exploded'),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('logs write failures and retries on the next tick', async () => {
    (fs.writeFile as unknown as jest.Mock).mockImplementationOnce(
      ((_path: unknown, _data: unknown, cb: any) =>
        cb(new Error('read-only file system'))) as any,
    );

    startDiagnosticFile(emptySnapshot, 1, {});

    await jest.advanceTimersByTimeAsync(30_000);

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('read-only file system'),
    );
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('does not start a second writer when the in-loop call runs later', async () => {
    startDiagnosticFile(emptySnapshot, 1, {});
    const second = startDiagnosticFile(emptySnapshot, 1, {});

    await jest.advanceTimersByTimeAsync(30_000);

    expect(second).toBe(false);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('does not install termination listeners that would suppress default exit', () => {
    const sigterm = process.listenerCount('SIGTERM');
    const sigint = process.listenerCount('SIGINT');

    startDiagnosticFile(emptySnapshot, 1, {});

    expect(process.listenerCount('SIGTERM')).toBe(sigterm);
    expect(process.listenerCount('SIGINT')).toBe(sigint);
  });

  it('stops writing once stopped', async () => {
    startDiagnosticFile(emptySnapshot, 1, {});

    stopDiagnosticFile();
    await jest.advanceTimersByTimeAsync(120_000);

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(getDiagnosticTimer()).toBeUndefined();
  });

  it('keeps a kind out of observed while its CRD monitor is running', () => {
    process.env.OPERATOR_KIND_LIST = 'dummycrs,claimreleases';
    (global as any).__crdMonitors = new Map([
      ['default/dummycrs', { isStarted: () => true }],
    ]);

    startDiagnosticFile(emptySnapshot, 1, {});

    expect(lastWrittenDocument()).toContain(
      'crds:\n  observed:\n    - "claimreleases"\n',
    );
    expect(lastWrittenDocument()).toContain(
      '  missing:\n    - "default/dummycrs"\n',
    );
  });

  it('keeps a kind out of observed when its monitor stopped between ticks', () => {
    process.env.OPERATOR_KIND_LIST = 'dummycrs,claimreleases';
    // crdMonitor stops after the CRD becomes available but keeps the
    // registration and never reattaches an informer without a restart.
    (global as any).__crdMonitors = new Map([
      ['default/dummycrs', { isStarted: () => false }],
    ]);

    startDiagnosticFile(emptySnapshot, 1, {});

    expect(lastWrittenDocument()).toContain(
      'crds:\n  observed:\n    - "claimreleases"\n',
    );
    expect(lastWrittenDocument()).toContain('  missing:\n');
  });

  it('excludes a kind whose monitor is registered after the first snapshot', async () => {
    process.env.OPERATOR_KIND_LIST = 'dummycrs';
    (global as any).__crdMonitors = new Map();

    startDiagnosticFile(emptySnapshot, 1, {});

    expect(lastWrittenDocument()).toContain('crds:\n  observed:\n    - "dummycrs"\n');

    // The monitor registers later and is already stopped by the next tick.
    (global as any).__crdMonitors = new Map([
      ['default/dummycrs', { isStarted: () => false }],
    ]);

    await jest.advanceTimersByTimeAsync(30_000);

    // Not missing any more (the monitor stopped), but never observed either:
    // no informer was attached, so the kind needs an operator restart.
    expect(lastWrittenDocument()).toContain('crds:\n  observed:\n  missing:\n');
  });
});
