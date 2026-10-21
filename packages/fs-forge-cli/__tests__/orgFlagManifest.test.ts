import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { contextFixture } from './fixtures/contextFixtures';

const ROOT = process.cwd();
const PROBE = join(ROOT, '__tests__', 'fixtures', 'cachedOrgDefaults.mjs');
const CONTEXT_ORG = 'ctx-org';

function cachedOrgDefaults(mode: 'cache' | 'nocache'): string[] {
  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', PROBE, ROOT, mode],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        FSCRT_ORG: CONTEXT_ORG,
        FS_FORGE_CONFIG: contextFixture('absent.yaml'),
      },
    },
  );
  return JSON.parse(stdout.trim()) as string[];
}

describe('the org flag default and the manifest', () => {
  it('would cache a context-resolved org as a flag default', () => {
    expect(cachedOrgDefaults('cache')).toEqual(
      expect.arrayContaining([
        `delete=${CONTEXT_ORG}`,
        `preflight=${CONTEXT_ORG}`,
        `create:component=${CONTEXT_ORG}`,
      ]),
    );
  }, 30_000);

  it('does not cache a context-resolved org as a manifest default', () => {
    expect(cachedOrgDefaults('nocache')).toEqual([]);
  }, 30_000);

  it('ships a manifest without any org default', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'oclif.manifest.json'), 'utf8'),
    ) as { commands: Record<string, { flags?: Record<string, object> }> };
    const cached = Object.entries(manifest.commands).flatMap(([id, command]) => {
      const org = command.flags?.org;
      return org && 'default' in org
        ? [`${id}: ${JSON.stringify(org.default)}`]
        : [];
    });

    expect(cached).toEqual([]);
  });
});
