import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import common from 'catalog_common';
import { apply } from '../src/utils';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));

const { spawn } = jest.requireMock('child_process') as typeof import('child_process');

const TRANSIENT_ERROR =
  'Error: Provider produced inconsistent result after apply\n' +
  'provider "integrations/github" produced an unexpected new value:\n' +
  'root object was present, but now absent.\n';

const UNRELATED_ERROR = 'Error: credential validation failed\n';

function fakeTofuProcess(code: number | null, stdoutText: string, stderrText: string) {
  const proc = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;

  setImmediate(() => {
    if (stdoutText) stdout.write(stdoutText);
    if (stderrText) stderr.write(stderrText);
    stdout.end();
    stderr.end();
    setImmediate(() => proc.emit('exit', code));
  });

  return proc;
}

describe('apply transient retry', () => {
  beforeEach(() => {
    jest.spyOn(common.generic, 'sleep').mockResolvedValue(undefined);
    (spawn as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves when a transient error is followed by a successful apply', async () => {
    (spawn as jest.Mock)
      .mockImplementationOnce(() => fakeTofuProcess(1, '', TRANSIENT_ERROR))
      .mockImplementationOnce(() => fakeTofuProcess(0, 'Apply complete!\n', ''));

    await expect(apply('/tmp/fake', [])).resolves.toContain('Apply complete!');
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the maximum attempts on a persistent transient error', async () => {
    (spawn as jest.Mock).mockImplementation(() =>
      fakeTofuProcess(1, '', TRANSIENT_ERROR),
    );

    await expect(apply('/tmp/fake', [])).rejects.toThrow(
      'Provider produced inconsistent result after apply',
    );
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on a non-transient error', async () => {
    (spawn as jest.Mock).mockImplementation(() =>
      fakeTofuProcess(1, '', UNRELATED_ERROR),
    );

    await expect(apply('/tmp/fake', [])).rejects.toThrow(
      'credential validation failed',
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the first apply succeeds', async () => {
    (spawn as jest.Mock).mockImplementation(() =>
      fakeTofuProcess(0, 'Apply complete!\n', ''),
    );

    await expect(apply('/tmp/fake', [])).resolves.toContain('Apply complete!');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
