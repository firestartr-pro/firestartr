import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

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

// The Kubernetes CRs a provider pass wrote for run `run` (run 1 is the first
// measured run; run 0 is the warm-up).
function githubCrs(out: string, run: number): any[] {
  const dir = path.join(out, `run-${run}`, 'github', 'crs');
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => parseYaml(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

// The github CRs' annotations keyed by `<kind>::<firestartr.dev/claim-ref>`.
// Keyed by claim-ref (not name) because generated names carry a per-run UUID,
// and by kind as well because several CRs share one claim-ref (the repository,
// its feature, and its secrets-section all reference the same ComponentClaim).
function githubAnnotationsByClaimRef(
  out: string,
  run: number,
): Record<string, Record<string, string>> {
  // Only the claim's main CR: feature and secrets-section CRs carry a per-run
  // UUID in some annotation values, which no two runs share.
  const mainKinds = new Set([
    'FirestartrGithubRepository',
    'FirestartrGithubGroup',
    'FirestartrGithubMembership',
  ]);
  const map: Record<string, Record<string, string>> = {};
  for (const cr of githubCrs(out, run)) {
    if (!mainKinds.has(cr.kind)) continue;
    const ref = cr.metadata?.annotations?.['firestartr.dev/claim-ref'];
    if (ref) map[`${cr.kind}::${ref}`] = cr.metadata.annotations;
  }
  return map;
}

function componentClaims(g: Generated): any[] {
  const dir = path.join(g.claims, 'components');
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => parseYaml(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-tools-'));
let first: Generated;
let second: Generated;
let singleGroup: Generated;

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

function harnessArgsWithClaims(
  claims: string,
  out: string,
  extra: string[] = [],
): string[] {
  const args = harnessArgs(out, extra);
  args[args.indexOf('--claims') + 1] = claims;
  return args;
}

// A claims view whose generator-manifest.json is absent (or overridden), with
// the real claims tree exposed through a symlink.
function manifestView(name: string, manifest?: unknown): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const claims = path.join(dir, 'claims');
  if (!fs.existsSync(claims)) fs.symlinkSync(first.claims, claims);
  if (manifest !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'generator-manifest.json'),
      JSON.stringify(manifest),
    );
  }
  return claims;
}

// A claims view whose generator-manifest.json holds unparseable raw content.
function corruptManifestView(name: string, contents: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const claims = path.join(dir, 'claims');
  if (!fs.existsSync(claims)) fs.symlinkSync(first.claims, claims);
  fs.writeFileSync(path.join(dir, 'generator-manifest.json'), contents);
  return claims;
}

beforeAll(() => {
  first = generate(path.join(root, 'seed-7-a'), 7, 12);
  second = generate(path.join(root, 'seed-7-b'), 7, 12);
  singleGroup = generate(path.join(root, 'single-group'), 3, 10);
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

  it('rejects an --org the claim schemas would refuse, before wiping --out', () => {
    const badOrgs = [
      'Bench', // uppercase
      'bench-', // trailing separator
      'a'.repeat(52), // orgsettings-<org> would exceed 63 chars (12 + 52)
    ];
    badOrgs.forEach((org, i) => {
      const dir = path.join(root, `org-guard-${i}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.bench-owned'), 'benchmark output\n');
      fs.writeFileSync(path.join(dir, 'sentinel.txt'), 'keep');

      const result = run([
        GENERATOR, '--out', dir, '--org', org, '--tier', '10', '--jobs', '2',
      ]);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('Invalid --org');
      // Validation must precede the wipe: the previous fixture survives intact.
      expect(fs.readFileSync(path.join(dir, 'sentinel.txt'), 'utf-8')).toBe('keep');
      expect(fs.readdirSync(dir).sort()).toEqual(
        ['.bench-owned', 'sentinel.txt'],
      );
    });
  });

  it('never assigns a maintainedBy group equal to owner or platformOwner', () => {
    // The repository chart grants owner/platformOwner `admin` and maintainedBy
    // `maintain`; the same group in both roles fails permission-uniqueness.
    for (const tree of [first, singleGroup]) {
      for (const claim of componentClaims(tree)) {
        for (const maintainer of claim.maintainedBy ?? []) {
          expect(maintainer).not.toBe(claim.owner);
          expect(maintainer).not.toBe(claim.platformOwner);
        }
      }
    }
    // A single-group tier has no third group to draw from, so maintainedBy is
    // omitted rather than colliding.
    for (const claim of componentClaims(singleGroup)) {
      expect(claim.maintainedBy).toBeUndefined();
    }
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

    // The offline stitching mock must feed real patch envelopes so the
    // normalization/conflict/apply phases run instead of short-circuiting.
    expect(report.featureEnvelopes).toBeGreaterThan(0);
    expect(report.featurePatches).toBeGreaterThan(0);
  });

  it('escapes a "/" in a feature name so the stitched annotation stays a string', () => {
    const dir = path.join(root, 'slash-feature');
    const claims = path.join(dir, 'claims');
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(first.claims, claims, { recursive: true });
    fs.copyFileSync(
      path.join(first.dir, 'generator-manifest.json'),
      path.join(dir, 'generator-manifest.json'),
    );

    // `/` is legal in an annotation key but is the JSON Pointer separator, so
    // the mock must escape it rather than let the pointer nest the value (which
    // would fail the annotations schema and abort the load).
    const components = path.join(claims, 'components');
    const file = path.join(
      components,
      fs.readdirSync(components).filter((f) => /\.ya?ml$/.test(f)).sort()[0],
    );
    const claim = parseYaml(fs.readFileSync(file, 'utf-8'));
    const claimName = claim.name;
    claim.providers.github.features = [{ name: 'team/api', version: '1.0.0' }];
    fs.writeFileSync(file, stringifyYaml(claim));

    const out = path.join(dir, 'out');
    const result = run(
      harnessArgsWithClaims(claims, out, [
        '--json', path.join(dir, 'report.json'),
        '--repeat', '2',
        '--providers', 'github',
      ]),
    );
    expect(result.status).toBe(0);
    const annotations = githubAnnotationsByClaimRef(out, 1);
    expect(
      annotations[
        `FirestartrGithubRepository::ComponentClaim/${claimName}`
      ]['bench-0-team/api'],
    ).toBe('team/api@1.0.0');
  });

  it('renders a provider identically whatever the provider order', () => {
    // Catalog charts alias `claim.annotations` and the catalog patches mutate
    // it in place; without per-pass isolation the github pass would inherit
    // catalog-only annotations (title, backstage.io/*) that a github-only run
    // never produces.
    const only = path.join(root, 'order-github-only');
    const combined = path.join(root, 'order-catalog-github');
    const a = run(
      harnessArgs(only, [
        '--json', path.join(root, 'order-a.json'),
        '--repeat', '2',
        '--providers', 'github',
      ]),
    );
    expect(a.status).toBe(0);
    const b = run(
      harnessArgs(combined, [
        '--json', path.join(root, 'order-b.json'),
        '--repeat', '2',
        '--providers', 'catalog,github',
      ]),
    );
    expect(b.status).toBe(0);
    expect(githubAnnotationsByClaimRef(only, 1)).toEqual(
      githubAnnotationsByClaimRef(combined, 1),
    );
  });

  it('refuses to render without a valid generator manifest', () => {
    const views = [
      manifestView('manifest-missing'),
      manifestView('manifest-invalid', { total: 0 }),
      corruptManifestView('manifest-corrupt', '{"total": 12'),
    ];
    for (const claims of views) {
      const dir = path.dirname(claims);
      const out = path.join(root, `refused-${path.basename(dir)}`);
      const result = run(
        harnessArgsWithClaims(claims, out, [
          '--json', path.join(dir, 'report.json'),
          '--repeat', '2',
          '--providers', 'catalog',
        ]),
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'generator manifest',
      );
      expect(fs.existsSync(out)).toBe(false);
      expect(fs.existsSync(path.join(dir, 'report.json'))).toBe(false);
    }
  });

  it('renders unverified inputs only with --allow-unverified', () => {
    const views: [string, string][] = [
      ['allow-missing', ''],
      ['allow-invalid', 'invalid'],
      ['allow-corrupt', 'corrupt'],
    ];
    for (const [name, kind] of views) {
      const claims =
        kind === 'corrupt'
          ? corruptManifestView(name, '{"total": 12')
          : manifestView(
              name,
              kind === 'invalid' ? { total: 0 } : undefined,
            );
      const out = path.join(root, `${name}-out`);
      const json = path.join(root, `${name}-report.json`);
      const result = run(
        harnessArgsWithClaims(claims, out, [
          '--json', json,
          '--repeat', '2',
          '--providers', 'catalog',
          '--allow-unverified',
        ]),
      );
      expect(result.status).toBe(0);
      const report = JSON.parse(fs.readFileSync(json, 'utf-8'));
      expect(report.expectedClaims).toBeNull();
      expect(report.loadedClaims).toBe(first.manifest.total);
      expect(`${result.stdout}${result.stderr}`).toContain(
        'completeness check is disabled',
      );
    }
  });

  it('checks every run against the manifest total, including the warm-up', () => {
    // The real fixture loads 12 claims per run; a manifest total of 13 makes
    // run 0 (the warm-up, which the old measured[0]-only guard never saw)
    // fail its check, so the harness must abort before any run is timed.
    const claims = manifestView('manifest-mismatch', { total: 13 });
    const dir = path.dirname(claims);
    const out = path.join(root, 'mismatch-out');
    const json = path.join(root, 'mismatch-report.json');
    const result = run(
      harnessArgsWithClaims(claims, out, [
        '--json', json,
        '--repeat', '2',
        '--providers', 'catalog',
      ]),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Correctness guard failed: run 0 loaded 12 claims, expected 13',
    );
    expect(fs.existsSync(json)).toBe(false);
    // The harness wipes + marks --out before the loop, but aborts on run 0,
    // so no per-run output directories are ever created.
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readdirSync(out)).toEqual(['.bench-owned']);
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

  it('refuses an --out inside one of its inputs, even with --force', () => {
    // Rendering into <claims>/... would seed the claims tree with rendered YAML
    // that later runs rediscover as input, and --force must not allow it.
    const nested = path.join(first.claims, 'nested-out');
    for (const extra of [[], ['--force']]) {
      const result = run(
        harnessArgs(nested, ['--repeat', '2', '--providers', 'catalog', ...extra]),
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('Refusing to wipe');
      expect(fs.existsSync(first.claims)).toBe(true);
      expect(fs.existsSync(path.join(first.claims, 'orgSettings'))).toBe(true);
    }
  });

  it('treats a ".."-prefixed name as a child, not an escape', () => {
    // <claims>/..rendered is a real child of the claims input (its name merely
    // starts with ".."), so the two-way overlap rule must refuse it. The
    // pre-created marker defeats the separate non-empty-unmarked rule, isolating
    // the containment check.
    const out = path.join(first.claims, '..rendered');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, '.bench-owned'), '');
    fs.writeFileSync(path.join(out, 'canary.txt'), 'keep');

    const result = run(
      harnessArgs(out, ['--repeat', '2', '--providers', 'catalog']),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing to wipe');
    expect(fs.existsSync(path.join(out, 'canary.txt'))).toBe(true);
  });

  it('rejects inherited provider names like constructor', () => {
    for (const provider of ['constructor', 'toString', 'hasOwnProperty']) {
      const result = run(
        harnessArgs(path.join(root, `prov-${provider}`), [
          '--repeat',
          '2',
          '--providers',
          provider,
        ]),
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        `Unknown provider ${provider}`,
      );
    }
  });

  // The in-repo rule (any --out inside the repo except <repo>/.tmp_dir is
  // refused) is not integration-tested: pointing --out at a real repo directory
  // would delete that directory if the guard ever regressed. It is covered by
  // review; the two-way machinery itself is exercised by the input tests above.

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
