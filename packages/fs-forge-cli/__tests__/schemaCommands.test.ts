import { describe, expect, it } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';

import SchemaList from '../src/commands/schema/list';
import SchemaShow from '../src/commands/schema/show';

const ROOT = process.cwd();
const CONTRACTS = ['CommandHelpJson', 'RelationGraph', 'MutationDiff'];

async function runList(...args: string[]) {
  return captureOutput(async () => {
    await SchemaList.run(args, { root: ROOT });
    return 0;
  });
}

async function runShow(...args: string[]) {
  return captureOutput(async () => {
    await SchemaShow.run(args, { root: ROOT });
    return 0;
  });
}

describe('schema commands', () => {
  it('lists the published contract names', async () => {
    const { result, stdout } = await runList();

    expect(result).toBe(0);
    expect(stdout.trim().split('\n')).toEqual(['NAME', ...CONTRACTS]);
  });

  it('lists contract names as JSON', async () => {
    const { result, stdout } = await runList('--json');

    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toEqual(CONTRACTS);
  });

  for (const name of CONTRACTS) {
    it(`prints ${name} exactly as stored on disk`, async () => {
      const { result, stdout } = await runShow(name);
      const expected = readFileSync(
        join(ROOT, 'schemas', `${name}.json`),
        'utf8',
      );

      expect(result).toBe(0);
      expect(stdout).toBe(expected);
    });
  }

  it('rejects an unknown contract name', async () => {
    const { error } = await runShow('Unknown');

    expect(error?.message).toContain('Unknown schema: Unknown');
    expect(error?.message).toContain('CommandHelpJson');
  });
});
