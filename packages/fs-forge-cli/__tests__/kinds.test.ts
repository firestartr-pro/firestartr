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

const CAPABILITY_KEYS = [
  'id',
  'kind',
  'description',
  'claimsDirectory',
  'requiresPath',
  'catalogOnly',
  'orgField',
  'hydration',
  'delete',
  'variants',
  'preflight',
  'stateRepo',
  'references',
];

type KindEntry = Record<string, unknown> & {
  kind: string;
  description: string;
  hydration: Record<string, unknown> | null;
  delete: Record<string, unknown>;
};

async function kindsJson(): Promise<KindEntry[]> {
  const { stdout } = await captureOutput(async () => {
    await Kinds.run(['--json'], { root: ROOT });
    return 0;
  });
  return JSON.parse(stdout) as KindEntry[];
}

it('uses each claim schema summary in the kinds output', async () => {
  const kinds = await kindsJson();

  expect(kinds.map(({ kind }) => kind)).toEqual(CLAIM_KINDS);
  for (const entry of kinds) {
    const schema = JSON.parse(
      readFileSync(join(ROOT, 'schemas', `${entry.kind}.json`), 'utf8'),
    ) as { 'x-fs-forge-summary': string };
    expect(entry.description).toBe(schema['x-fs-forge-summary']);
    expect(entry.description).not.toMatch(/^A(n)? \w+ claim$/);
  }
});

it('carries the full per-kind capability shape for every kind', async () => {
  for (const entry of await kindsJson()) {
    expect(Object.keys(entry).sort()).toEqual([...CAPABILITY_KEYS].sort());
    expect(entry.hydration === null || typeof entry.hydration === 'object').toBe(
      true,
    );
    if (entry.hydration) {
      expect(Object.keys(entry.hydration).sort()).toEqual([
        'inputs',
        'key',
        'workflow',
      ]);
    }
    expect(Object.keys(entry.delete).sort()).toEqual(['supported', 'workflow']);
    expect(entry.delete.supported).toBe(entry.delete.workflow !== null);
    expect(Array.isArray(entry.references)).toBe(true);
  }
});

it('describes the component kind with the facts the CLI dispatches', async () => {
  const entries = await kindsJson();
  const component = entries.find(({ kind }) => kind === 'ComponentClaim');

  expect(component).toEqual({
    id: 'component',
    kind: 'ComponentClaim',
    description:
      'Describe a software component and the repository that hosts it.',
    claimsDirectory: 'components',
    requiresPath: false,
    catalogOnly: false,
    orgField: 'providers.github.org',
    hydration: {
      workflow: 'hydrate-github-claim.yaml',
      key: 'name',
      inputs: ['kind', 'name'],
    },
    delete: { supported: true, workflow: 'delete-github-claim.yaml' },
    variants: false,
    preflight: 'repo',
    stateRepo: 'state-github',
    references: [
      'system',
      'owner',
      'maintainedBy[]',
      'platformOwner',
      'subComponentOf',
    ],
  });
});
