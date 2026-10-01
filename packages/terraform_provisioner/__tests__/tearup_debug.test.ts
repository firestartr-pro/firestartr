import { TFProjectManager } from '../src/project_tf';
import { TFProjectManagerRemote } from '../src/project_tf_remote';

const fs = require('fs');

describe('tearUpProject debug protection', () => {
  const DEBUG_PATH = '/tmp/tf-debug/testkind-testname-zzzz';

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    try {
      fs.rmSync(DEBUG_PATH, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup failures
    }
  });

  it('should not remove debug inline workspace', async () => {
    const rmSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => {});

    const mgr = new TFProjectManager({ projectPath: DEBUG_PATH } as any);
    await expect(mgr.tearUpProject()).resolves.toBeUndefined();

    expect(rmSpy).not.toHaveBeenCalled();
    rmSpy.mockRestore();
  });

  it('should not remove debug remote workspace', async () => {
    const rmSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => {});

    const mgr = new TFProjectManagerRemote({ projectPath: DEBUG_PATH } as any);
    await expect(mgr.tearUpProject()).resolves.toBeUndefined();

    expect(rmSpy).not.toHaveBeenCalled();
    rmSpy.mockRestore();
  });

  it('should preserve debug workspace when annotation handling moved to operator', async () => {
    // create a fake file under the normalized path and ensure initTfDebug
    // no longer removes deterministic debug folders; snapshot/cleanup is
    // performed by the operator now.
    const normalized = '/tmp/tf-debug/testkind-testname-zzzz';
    const filePath = `${normalized}/tf_provisioner_debug/old.txt`;
    try {
      fs.mkdirSync(normalized, { recursive: true });
      fs.mkdirSync(`${normalized}/tf_provisioner_debug`, { recursive: true });
      fs.writeFileSync(filePath, 'old');
    } catch (e) {}

    const ctx: any = { projectPath: normalized, rawCr: { metadata: { annotations: {} } } };

    // call initTfDebug via requiring the module (same flow as build())
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const debug = require('../src/debug');
    await debug.initTfDebug(ctx);

    // the file should still exist because debug init no longer removes
    // deterministic debug folders.
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
