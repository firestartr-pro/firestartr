import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';
import {
  FIRESTARTR_ANNOTATIONS,
  getFirestartrAnnotation,
} from '../../src/claim-taxonomy';
import { pickRenderedCr, setReconcileAt } from '../../src/render-artifacts';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-claim-taxonomy-'));
  tempDirs.push(dir);
  return dir;
}

async function writeCr(
  dir: string,
  fileName: string,
  kind: string,
  annotations: Record<string, string> = {},
): Promise<string> {
  const filePath = path.join(dir, fileName);
  await fs.writeFile(
    filePath,
    common.io.toYaml({
      apiVersion: 'firestartr.dev/v1',
      kind,
      metadata: { name: fileName.replace(/\.yaml$/, ''), annotations },
    }),
    'utf-8',
  );
  return filePath;
}

describe('Firestartr annotation vocabulary', () => {
  it('names every Firestartr annotation from one constant', () => {
    expect(FIRESTARTR_ANNOTATIONS).toEqual({
      claimRef: 'claim-ref',
      reconcileAt: 'reconcile-at',
      import: 'import',
      externalName: 'external-name',
    });

    expect(getFirestartrAnnotation('claimRef')).toBe(
      'firestartr.dev/claim-ref',
    );
    expect(getFirestartrAnnotation('reconcileAt')).toBe(
      'firestartr.dev/reconcile-at',
    );
    expect(getFirestartrAnnotation('import')).toBe('firestartr.dev/import');
    expect(getFirestartrAnnotation('externalName')).toBe(
      'firestartr.dev/external-name',
    );
  });
});

describe('pickRenderedCr', () => {
  afterAll(async () => {
    await Promise.all(
      tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('throws when no rendered CR matches the kind', async () => {
    const dir = await makeTempDir();
    const groupCr = await writeCr(dir, 'group-a.yaml', 'FirestartrGithubGroup');

    await expect(
      pickRenderedCr([groupCr], 'FirestartrGithubRepository'),
    ).rejects.toThrow('FirestartrGithubRepository');
  });

  it('returns the first match in render order when several match', async () => {
    const dir = await makeTempDir();
    const first = await writeCr(
      dir,
      'repo-a.yaml',
      'FirestartrGithubRepository',
    );
    const second = await writeCr(
      dir,
      'repo-b.yaml',
      'FirestartrGithubRepository',
    );
    const other = await writeCr(dir, 'group-a.yaml', 'FirestartrGithubGroup');

    await expect(
      pickRenderedCr([other, first, second], 'FirestartrGithubRepository'),
    ).resolves.toBe(first);
  });
});

describe('setReconcileAt', () => {
  afterAll(async () => {
    await Promise.all(
      tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('stamps exactly one annotation and preserves the others', async () => {
    const dir = await makeTempDir();
    const crPath = await writeCr(
      dir,
      'repo-a.yaml',
      'FirestartrGithubRepository',
      {
        'firestartr.dev/claim-ref': 'ComponentClaim/repo-a',
      },
    );

    await setReconcileAt(crPath);

    const resource = common.io.fromYaml(await fs.readFile(crPath, 'utf-8')) as {
      metadata?: { annotations?: Record<string, string> };
    };
    const annotations = resource.metadata?.annotations ?? {};

    expect(Object.keys(annotations).sort()).toEqual([
      'firestartr.dev/claim-ref',
      'firestartr.dev/reconcile-at',
    ]);
    expect(annotations['firestartr.dev/claim-ref']).toBe(
      'ComponentClaim/repo-a',
    );
    expect(
      Number.isNaN(Date.parse(annotations['firestartr.dev/reconcile-at'])),
    ).toBe(false);
  });
});
