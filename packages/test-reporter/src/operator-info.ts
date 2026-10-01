import * as fs from 'fs';
import type { OperatorInfo, ExecFn } from './types';

const QUEUE_PATH = '/tmp/queue';
const DIAGNOSTICS_PATH = '/tmp/diagnostics';

function readTmpFile(path: string): string {
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

export async function readOperatorInfoViaFs(): Promise<OperatorInfo> {
  return {
    queue: readTmpFile(QUEUE_PATH),
    diagnostics: readTmpFile(DIAGNOSTICS_PATH),
  };
}

export async function readOperatorInfoViaExec(
  execFn: ExecFn,
  podName: string,
  namespace: string,
): Promise<OperatorInfo> {
  const [queue, diagnostics] = await Promise.all([
    execFn(podName, namespace, ['cat', QUEUE_PATH]).catch(() => ''),
    execFn(podName, namespace, ['cat', DIAGNOSTICS_PATH]).catch(() => ''),
  ]);

  return { queue, diagnostics };
}
