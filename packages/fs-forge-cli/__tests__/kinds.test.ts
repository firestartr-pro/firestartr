import { describe, expect, it } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';

import Kinds from '../src/commands/kinds';

const ROOT = process.cwd();
const CLAIM_KINDS = [
  'ArgoDeployClaim',
  'ComponentClaim',
  'DomainClaim',
  'GroupClaim',
  'OrgSettingsClaim',
  'OrgWebhookClaim',
  'SecretsClaim',
  'SystemClaim',
  'TFWorkspaceClaim',
  'UserClaim',
];

it('uses each claim schema summary in the kinds output', async () => {
  const { stdout } = await captureOutput(async () => {
    await Kinds.run(['--json'], { root: ROOT });
    return 0;
  });
  const kinds = JSON.parse(stdout) as Array<{
    kind: string;
    description: string;
  }>;

  expect(kinds.map(({ kind }) => kind)).toEqual(CLAIM_KINDS);
  for (const entry of kinds) {
    const schema = JSON.parse(
      readFileSync(join(ROOT, 'schemas', `${entry.kind}.json`), 'utf8'),
    ) as { 'x-fs-forge-summary': string };
    expect(entry.description).toBe(schema['x-fs-forge-summary']);
    expect(entry.description).not.toMatch(/^A(n)? \w+ claim$/);
  }
});
