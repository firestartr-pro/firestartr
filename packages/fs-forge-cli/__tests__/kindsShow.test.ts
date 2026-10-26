import { describe, expect, it } from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';

import Kinds from '../src/commands/kinds';
import KindsShow from '../src/commands/kinds/show';

const ROOT = process.cwd();

type CommandClass = typeof Command &
  (new (argv: string[], config: Config) => Command);

/** A command that exits through `this.error` sets `process.exitCode`; restore it. */
async function run(command: CommandClass, ...args: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await command.run(args, { root: ROOT });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

async function kindsJson(): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await run(Kinds, '--json');
  return JSON.parse(stdout) as Array<Record<string, unknown>>;
}

describe('fs-forge kinds show', () => {
  it('prints one kind as JSON, exactly as the list command emits it', async () => {
    const { result, stdout } = await run(KindsShow, 'component', '--json');
    const listed = (await kindsJson()).find(
      ({ kind }) => kind === 'ComponentClaim',
    );

    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toEqual(listed);
  });

  it('accepts the short id and the full kind name', async () => {
    const byId = await run(KindsShow, 'component', '--json');
    const byKind = await run(KindsShow, 'ComponentClaim', '--json');

    expect(JSON.parse(byKind.stdout)).toEqual(JSON.parse(byId.stdout));
  });

  it('prints the capabilities as readable rows', async () => {
    const { result, stdout } = await run(KindsShow, 'tfworkspace');

    expect(result).toBe(0);
    expect(stdout).toMatch(/^TFWorkspaceClaim \(tfworkspace\)\n/);
    expect(stdout).toMatch(/^requires --path\s+yes$/m);
    expect(stdout).toMatch(/^variants\s+yes$/m);
    expect(stdout).toMatch(/^hydration\s+hydrate-tfworkspace-claim\.yaml/m);
    expect(stdout).toMatch(/^delete\s+delete-tfworkspace-claim\.yaml$/m);
    expect(stdout).toMatch(/^state repo\s+state-infra$/m);
  });

  it('says so when a kind has no hydration, delete or references', async () => {
    const { stdout } = await run(KindsShow, 'domain');

    expect(stdout).toMatch(/^hydration\s+none$/m);
    expect(stdout).toMatch(/^delete\s+none$/m);
    expect(stdout).toMatch(/^references\s+owner$/m);
  });

  it('rejects an unknown kind with the valid kinds', async () => {
    const { error } = await run(KindsShow, 'nope');

    expect(error?.message).toContain('Expected nope to be one of');
    expect(error?.message).toContain('argodeploy');
    expect(error?.message).toContain('tfworkspace');
  });

  it('leaves the process exit code as the caller had it', async () => {
    const before = process.exitCode;

    await run(KindsShow, 'nope');

    expect(process.exitCode).toBe(before);
  });
});
