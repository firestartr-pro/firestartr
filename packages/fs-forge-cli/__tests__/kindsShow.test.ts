import { describe, expect, it } from '@jest/globals';
import { captureOutput } from '@oclif/test';

import Kinds from '../src/commands/kinds';
import KindsShow from '../src/commands/kinds/show';

const ROOT = process.cwd();

async function runShow(...args: string[]) {
  return captureOutput(async () => {
    await KindsShow.run(args, { root: ROOT });
    return 0;
  });
}

async function kindsJson(): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await captureOutput(async () => {
    await Kinds.run(['--json'], { root: ROOT });
    return 0;
  });
  return JSON.parse(stdout) as Array<Record<string, unknown>>;
}

describe('fs-forge kinds show', () => {
  it('prints one kind as JSON, exactly as the list command emits it', async () => {
    const { result, stdout } = await runShow('component', '--json');
    const listed = (await kindsJson()).find(({ kind }) => kind === 'ComponentClaim');

    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toEqual(listed);
  });

  it('accepts the short id and the full kind name', async () => {
    const byId = await runShow('component', '--json');
    const byKind = await runShow('ComponentClaim', '--json');

    expect(JSON.parse(byKind.stdout)).toEqual(JSON.parse(byId.stdout));
  });

  it('prints the capabilities as readable rows', async () => {
    const { result, stdout } = await runShow('tfworkspace');

    expect(result).toBe(0);
    expect(stdout).toMatch(/^TFWorkspaceClaim \(tfworkspace\)\n/);
    expect(stdout).toMatch(/^requires --path\s+yes$/m);
    expect(stdout).toMatch(/^variants\s+yes$/m);
    expect(stdout).toMatch(/^hydration\s+hydrate-tfworkspace-claim\.yaml/m);
    expect(stdout).toMatch(/^delete\s+delete-tfworkspace-claim\.yaml$/m);
    expect(stdout).toMatch(/^state repo\s+state-infra$/m);
  });

  it('says so when a kind has no hydration, delete or references', async () => {
    const { stdout } = await runShow('domain');

    expect(stdout).toMatch(/^hydration\s+none$/m);
    expect(stdout).toMatch(/^delete\s+none$/m);
    expect(stdout).toMatch(/^references\s+owner$/m);
  });

  it('rejects an unknown kind with the valid kinds', async () => {
    const { error } = await runShow('nope');

    expect(error?.message).toContain('Expected nope to be one of');
    expect(error?.message).toContain('argodeploy');
    expect(error?.message).toContain('tfworkspace');
  });
});
