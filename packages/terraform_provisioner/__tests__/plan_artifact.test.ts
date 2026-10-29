import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { planArtifact, PLAN_ARTIFACT_FILE } from '../src/utils';
import log from '../src/logger';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));

const { spawn } = jest.requireMock('child_process') as typeof import('child_process');

function fakeTofuProcess(code: number, stdoutText: string) {
  const proc = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;

  setImmediate(() => {
    if (stdoutText) stdout.write(stdoutText);
    stdout.end();
    stderr.end();
    setImmediate(() => proc.emit('exit', code));
  });

  return proc;
}

const PLAN_TEXT =
  'OpenTofu will perform the following actions:\n' +
  'Plan: 1 to add, 1 to change, 1 to destroy.\n';

const PLAN_JSON = {
  format_version: '1.2',
  resource_changes: [
    { address: 'a.created', change: { actions: ['create'] } },
    { address: 'b.updated', change: { actions: ['update'] } },
    { address: 'c.unchanged', change: { actions: ['no-op'] } },
    { address: 'd.replaced', change: { actions: ['delete', 'create'] } },
  ],
};

function tofuArgsOfCall(call: number): string[] {
  return (spawn as jest.Mock).mock.calls[call][1];
}

function fakeTofu() {
  (spawn as jest.Mock).mockImplementation((_bin: string, args: string[]) => {
    if (args[0] === 'plan') return fakeTofuProcess(0, 'planned\n');
    if (args.includes('-json')) return fakeTofuProcess(0, JSON.stringify(PLAN_JSON));
    return fakeTofuProcess(0, PLAN_TEXT);
  });
}

describe('planArtifact', () => {
  beforeEach(() => {
    (spawn as jest.Mock).mockReset();
    fakeTofu();
  });

  it('plans once into a plan file and renders it as text and JSON', async () => {
    const artifact = await planArtifact('/tmp/fake', [], false);

    expect(spawn).toHaveBeenCalledTimes(3);

    const planCalls = (spawn as jest.Mock).mock.calls.filter(
      (call: any[]) => call[1][0] === 'plan',
    );
    expect(planCalls).toHaveLength(1);
    expect(tofuArgsOfCall(0)).toEqual(
      expect.arrayContaining(['plan', `-out=${PLAN_ARTIFACT_FILE}`]),
    );
    expect(tofuArgsOfCall(1)).toEqual(['show', '-no-color', PLAN_ARTIFACT_FILE]);
    expect(tofuArgsOfCall(2)).toEqual(['show', '-json', PLAN_ARTIFACT_FILE]);

    expect(artifact.text).toBe(PLAN_TEXT);
    expect(artifact.json).toEqual(PLAN_JSON);
    expect(artifact.summary).toEqual({ add: 2, change: 1, destroy: 1 });
  });

  it('never takes the state lock', async () => {
    await planArtifact('/tmp/fake', [], false);

    expect(tofuArgsOfCall(0)).toContain('-lock=false');
    expect(tofuArgsOfCall(0).some((arg) => arg.startsWith('-lock-timeout'))).toBe(
      false,
    );
  });

  it('plans a destroy when asked to', async () => {
    await planArtifact('/tmp/fake', [], true);

    expect(tofuArgsOfCall(0)).toEqual(
      expect.arrayContaining(['plan', '-destroy', '-lock=false']),
    );
  });

  it('leaves excluded addresses out of the plan', async () => {
    await planArtifact('/tmp/fake', [], true, undefined, undefined, [
      'github_repository_file.user_managed["README.md/main"]',
    ]);

    expect(tofuArgsOfCall(0)).toContain(
      '-exclude=github_repository_file.user_managed["README.md/main"]',
    );
  });

  it('fails without rendering when the plan fails', async () => {
    (spawn as jest.Mock).mockImplementation(() =>
      fakeTofuProcess(1, 'Error: boom\n'),
    );

    await expect(planArtifact('/tmp/fake', [], false)).rejects.toThrow('boom');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  describe('keeps the JSON rendering out of logs and errors', () => {
    const SECRET = 's3cr3t-value';
    const SECRET_JSON = JSON.stringify({ ...PLAN_JSON, variables: { token: { value: SECRET } } });

    function loggedText(): string {
      return [infoSpy, errorSpy]
        .flatMap((spy) => spy.mock.calls)
        .map((call) => call.join(' '))
        .join('\n');
    }

    let infoSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      infoSpy = jest.spyOn(log, 'info');
      errorSpy = jest.spyOn(log, 'error');
    });

    afterEach(() => jest.restoreAllMocks());

    it('on success, while still returning the JSON', async () => {
      (spawn as jest.Mock).mockImplementation((_bin: string, args: string[]) => {
        if (args[0] === 'plan') return fakeTofuProcess(0, 'planned\n');
        if (args.includes('-json')) return fakeTofuProcess(0, SECRET_JSON);
        return fakeTofuProcess(0, PLAN_TEXT);
      });

      const artifact = await planArtifact('/tmp/fake', [], false);

      expect(artifact.json.variables.token.value).toBe(SECRET);
      expect(loggedText()).not.toContain(SECRET);
    });

    it('on failure', async () => {
      (spawn as jest.Mock).mockImplementation((_bin: string, args: string[]) => {
        if (args[0] === 'plan') return fakeTofuProcess(0, 'planned\n');
        if (args.includes('-json')) return fakeTofuProcess(1, SECRET_JSON);
        return fakeTofuProcess(0, PLAN_TEXT);
      });

      const error = await planArtifact('/tmp/fake', [], false).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(String(error.message)).not.toContain(SECRET);
      expect(JSON.stringify(error)).not.toContain(SECRET);
      expect(loggedText()).not.toContain(SECRET);
    });
  });
});
