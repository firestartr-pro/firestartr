import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PKG_ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG_ROOT, '..', '..');
const GENERATOR = path.join(PKG_ROOT, 'tools', 'generate-claims.mjs');
const HARNESS = path.join(PKG_ROOT, 'tools', 'bench-render.cjs');

jest.setTimeout(300000);

interface Generated {
  dir: string;
  claims: string;
  manifest: { seed: number; tier: number; perKind: Record<string, number>; total: number };
}

function run(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, args, {
    cwd: PKG_ROOT,
    encoding: 'utf-8',
    env: { ...process.env },
  });
}

function generate(dir: string, seed: number, tier: number): Generated {
  const result = run([
    GENERATOR,
    '--out', dir,
    '--tier', String(tier),
    '--seed', String(seed),
    '--jobs', '4',
  ]);
  if (result.status !== 0) {
    throw new Error(`generator failed:\n${result.stdout}\n${result.stderr}`);
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'generator-manifest.json'), 'utf-8'),
  );
  return { dir, claims: path.join(dir, 'claims'), manifest };
}

function treeHash(dir: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current).sort()) {
      const full = path.join(current, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else {
        hash.update(path.relative(dir, full));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-tools-'));
let first: Generated;
let second: Generated;

function harnessArgs(out: string, extra: string[] = []): string[] {
  return [
    HARNESS,
    '--claims', first.claims,
    '--globals', path.join(first.dir, 'globals'),
    '--initializers', path.join(first.dir, 'initializers'),
    '--claims-defaults', path.join(first.dir, '.config'),
    '--crs', path.join(first.dir, 'crs'),
    '--out', out,
    ...extra,
  ];
}

beforeAll(() => {
  first = generate(path.join(root, 'seed-7-a'), 7, 12);
  second = generate(path.join(root, 'seed-7-b'), 7, 12);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('generate-claims tool', () => {
  it('prints usage without invoking fs-forge', () => {
    const result = run([GENERATOR, '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node tools/generate-claims.mjs');
  });

  it('emits a claims tree whose per-kind counts sum to the tier', () => {
    expect(first.manifest.tier).toBe(12);
    const sum = Object.values(first.manifest.perKind).reduce((a, b) => a + b, 0);
    expect(sum).toBe(12);
    expect(first.manifest.perKind.orgSettings).toBe(1);
    for (const [plural, count] of Object.entries(first.manifest.perKind)) {
      const files = fs
        .readdirSync(path.join(first.claims, plural))
        .filter((f) => /\.ya?ml$/.test(f));
      expect(files).toHaveLength(count);
    }
    for (const dir of ['globals', 'initializers']) {
      expect(fs.existsSync(path.join(first.dir, dir))).toBe(true);
    }
    expect(
      fs.existsSync(path.join(first.dir, '.config', 'claims_defaults.yaml')),
    ).toBe(true);
    expect(fs.existsSync(path.join(first.dir, '.bench-owned'))).toBe(true);
  });

  it('refuses a non-empty unmarked --out and only overwrites with --force', () => {
    const dir = path.join(root, 'guarded-gen');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'keep');

    const refused = run([GENERATOR, '--out', dir, '--tier', '10', '--jobs', '2']);
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toContain('Refusing to wipe');
    expect(fs.existsSync(path.join(dir, 'stray.txt'))).toBe(true);

    const forced = run([
      GENERATOR, '--out', dir, '--tier', '10', '--jobs', '2', '--force',
    ]);
    expect(forced.status).toBe(0);
    expect(fs.existsSync(path.join(dir, '.bench-owned'))).toBe(true);
  });

  it('is byte-identical for the same seed and tier', () => {
    expect(treeHash(first.claims)).toBe(treeHash(second.claims));
    expect(fs.readFileSync(path.join(first.dir, 'generator-manifest.json'), 'utf-8'))
      .toBe(fs.readFileSync(path.join(second.dir, 'generator-manifest.json'), 'utf-8'));
  });

  it('produces a different tree for a different seed', () => {
    const other = generate(path.join(root, 'seed-8'), 8, 12);
    expect(treeHash(other.claims)).not.toBe(treeHash(first.claims));
  });
});

describe('bench-render tool', () => {
  it('prints usage without requiring credentials', () => {
    const result = run([HARNESS, '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node tools/bench-render.cjs');
    expect(`${result.stdout}${result.stderr}`).not.toContain('PREFAPP_BOT_PAT');
  });

  it('renders the tree, synthesizes catalog YAML, measures two-pass and saves both artifacts', () => {
    const json = path.join(first.dir, 'json-out', 'report.json');
    const result = run(
      harnessArgs(path.join(first.dir, 'out'), [
        '--json', json,
        '--repeat', '2',
        '--providers', 'catalog,github',
        '--two-pass',
        '--cpu-prof',
      ]),
    );
    expect(result.status).toBe(0);

    // Both artifacts land in a directory that did not exist beforehand.
    expect(fs.existsSync(json)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(json), 'report.cpuprofile'))).toBe(
      true,
    );

    const report = JSON.parse(fs.readFileSync(json, 'utf-8'));
    expect(report.loadedClaims).toBe(first.manifest.total);
    expect(report.expectedClaims).toBe(first.manifest.total);
    expect(report.warmUpDropped).toBe(1);
    for (const key of ['discoveryMs', 'loadMs', 'peakRssBytes']) {
      expect(report).toHaveProperty(key);
    }
    for (const provider of ['catalog', 'github']) {
      expect(report.perProvider[provider]).toHaveProperty('renderMs.median');
      expect(report.perProvider[provider]).toHaveProperty('synthMs.median');
    }
    expect(report.rawRuns).toHaveLength(2);

    // A catalog-only pass must actually write catalog YAML, not just count it.
    expect(report.perProvider.catalog.renderedCrs).toBeGreaterThan(0);
    const catalogOut = path.join(
      first.dir,
      'out',
      'run-1',
      'catalog',
      'catalog',
    );
    const catalogFiles = fs
      .readdirSync(catalogOut)
      .filter((f) => /\.ya?ml$/.test(f));
    expect(catalogFiles.length).toBeGreaterThan(0);

    // Two-pass runs per provider that yields usable previous CRs (github), and
    // skips catalog (getPreviousCRfromClaim ignores catalog entities).
    expect(report.perProvider.github.twoPassRenderMs).not.toBeNull();
    expect(report.perProvider.catalog.twoPassRenderMs).toBeNull();
    expect(report.twoPassSkipped).toContain('catalog');
  });

  it('refuses an --out that contains one of its inputs', () => {
    // first.dir holds claims/, globals/, initializers/, .config/, crs/: using it
    // as --out would delete every input before discovery.
    const result = run(
      harnessArgs(first.dir, ['--repeat', '2', '--providers', 'catalog']),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing to wipe');
    expect(fs.existsSync(first.claims)).toBe(true);
  });

  it('refuses to wipe the repository root', () => {
    const result = run(
      harnessArgs(REPO, ['--repeat', '2', '--providers', 'catalog']),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing to wipe');
    expect(fs.existsSync(path.join(REPO, 'AGENTS.md'))).toBe(true);
  });

  it('resolves symlink aliases before deciding what --out contains', () => {
    const link = path.join(root, 'out-alias');
    fs.symlinkSync(first.dir, link);
    const result = run(
      harnessArgs(link, ['--repeat', '2', '--providers', 'catalog']),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing to wipe');
  });

  it('refuses a non-empty unmarked --out and overwrites with --force', () => {
    const out = path.join(root, 'guarded-harness-out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'stray.txt'), 'keep');

    const refused = run(
      harnessArgs(out, ['--repeat', '2', '--providers', 'catalog']),
    );
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toContain('Refusing to wipe');
    expect(fs.existsSync(path.join(out, 'stray.txt'))).toBe(true);

    const forced = run(
      harnessArgs(out, [
        '--json', path.join(out, 'report.json'),
        '--repeat', '2',
        '--providers', 'catalog',
        '--force',
      ]),
    );
    expect(forced.status).toBe(0);
    expect(fs.existsSync(path.join(out, '.bench-owned'))).toBe(true);
  });
});
