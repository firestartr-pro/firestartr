// Render benchmark harness for cdk8s_renderer.
//
// Drives the renderer only through its public API and times each phase
// (discover, load, render+validate, synth) around it, with a process-wide peak
// RSS measurement and optional CPU profiling. Fully offline: stitching and feature overrides
// are mocked and no credentials are read. It never compares against golden
// output; the only correctness guard is that rendering validates cleanly and
// the loaded-claim count matches the generator manifest.
//
// Run from the repo root:
//   node packages/cdk8s_renderer/tools/bench-render.cjs [options]

import fs from 'node:fs';
import path from 'node:path';
import { Session } from 'node:inspector';
import { Testing, YamlOutputType } from 'cdk8s';

import { MOCK_STITCHING_FEATURES } from '../src/claims/stitching/stitching';
import {
  AllowedProviders,
  configureProvider,
  reconfigureProvider,
  setDefaultBranch,
  setExcludedPaths,
  setPath,
  setRenamesEnabled,
  setRepositoryUrl,
} from '../src/config';
import { loadClaimsList } from '../src/loader/loader';
import { resetLazyLoader } from '../src/loader/lazy_loader';
import { MOCK_FEATURES } from '../src/overriders/featureOverride';
import { emptyRenderedClaims } from '../src/refresolver';
import { renderClaims } from '../src/renderer/claims-render';
import { resolveClaimEntries } from '../src/utils/claimUtils';
import { validateNoBackstageAnnotationsInK8sCrs } from '../src/validations/backstageAnnotations';
import { validateComponentPagesPath } from '../src/validations/componentPagesPath';
import { validateCrSizes } from '../src/validations/crSize';
import { validateSubReferences } from '../src/validations/crossReferences';
import { validateGithubOrgSettingsSingleton } from '../src/validations/githubOrgSettings';
import {
  validateActionsVariablesUniqueness,
  validateGithubOrgVariableSectionSingleton,
} from '../src/validations/githubOrgVariableSection';
import { validatePermissionsUniqueness } from '../src/validations/permissions';
import { validateTfStateKeyUniqueness } from '../src/validations/references';

const TOOLS_DIR = path.dirname(path.resolve(process.argv[1] ?? ''));
const PKG_ROOT = path.resolve(TOOLS_DIR, '..');
const REPO = path.resolve(PKG_ROOT, '..', '..');
const BENCH = path.join(REPO, '.tmp_dir', 'bench');
const MARKER = '.bench-owned';

// Resolve a path to its real location, following symlinks, even when the leaf
// does not exist yet: realpath the deepest existing ancestor and re-append the
// remaining segments. This catches symlink aliases of the paths we must protect.
function canonicalize(p: string): string {
  let existing = path.resolve(p);
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = fs.realpathSync(existing);
  } catch {
    // Keep the resolved path when realpath fails.
  }
  return path.join(real, ...tail);
}

function contains(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Refuse to wipe an --out that contains (or equals) any input directory or the
// repository itself. Not overridable: --force only relaxes the marker check.
function assertCanWipe(out: string, protectedPaths: string[]): void {
  const outReal = canonicalize(out);
  for (const p of protectedPaths) {
    if (contains(outReal, canonicalize(p))) {
      throw new Error(
        `Refusing to wipe ${out}: it contains ${p}. ` +
          'Choose an --out that contains no inputs.',
      );
    }
  }
}

// The renderer's loader logs per-claim at info level; keep it out of the timed
// path unless the caller asked for it.
process.env.LOG_LEVEL ??= 'error';

const USAGE = `Usage: node tools/bench-render.cjs [options]

Options:
  --claims <dir>            Claims root (default: <repo>/.tmp_dir/bench/claims)
  --globals <dir>           Globals dir (default: <repo>/.tmp_dir/bench/globals)
  --initializers <dir>      Initializers dir (default: <repo>/.tmp_dir/bench/initializers)
  --claims-defaults <dir>   Claims defaults dir (default: <repo>/.tmp_dir/bench/.config)
  --crs <dir>               Previous CRs dir (default: <repo>/.tmp_dir/bench/crs)
  --out <dir>               Scratch output for rendered CRs (default: <repo>/.tmp_dir/bench/out)
  --org <name>              Org used for repository URLs (default: bench)
  --providers <list>        Comma-separated providers (default: catalog,github,terraform,externalSecrets,argocd)
  --repeat <n>              Measured repeats; run 0 is a warm-up (default: 3)
  --json <path>             Report path (default: <repo>/.tmp_dir/bench/report.json)
  --cpu-prof                Write a V8 CPU profile next to the report
  --two-pass                Render once, then re-render with the produced CRs as previous CRs
  --force                   Wipe a non-empty --out that lacks the ${MARKER} marker
  --help                    Show this help`;

const PROVIDER_ENUM: Record<string, AllowedProviders> = {
  catalog: AllowedProviders.catalog,
  github: AllowedProviders.github,
  terraform: AllowedProviders.terraform,
  externalSecrets: AllowedProviders.externalSecrets,
  argocd: AllowedProviders.argocd,
};

interface Args {
  claims: string;
  globals: string;
  initializers: string;
  claimsDefaults: string;
  crs: string;
  out: string;
  org: string;
  providers: string[];
  repeat: number;
  json: string;
  cpuProf: boolean;
  twoPass: boolean;
  force: boolean;
}

function parse(argv: string[]): Args {
  const args: Args = {
    claims: path.join(BENCH, 'claims'),
    globals: path.join(BENCH, 'globals'),
    initializers: path.join(BENCH, 'initializers'),
    claimsDefaults: path.join(BENCH, '.config'),
    crs: path.join(BENCH, 'crs'),
    out: path.join(BENCH, 'out'),
    org: 'bench',
    providers: Object.keys(PROVIDER_ENUM),
    repeat: 3,
    json: path.join(BENCH, 'report.json'),
    cpuProf: false,
    twoPass: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value after ${k}`);
      return value;
    };
    if (k === '--help' || k === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (k === '--claims') args.claims = v();
    else if (k === '--globals') args.globals = v();
    else if (k === '--initializers') args.initializers = v();
    else if (k === '--claims-defaults') args.claimsDefaults = v();
    else if (k === '--crs') args.crs = v();
    else if (k === '--out') args.out = v();
    else if (k === '--org') args.org = v();
    else if (k === '--providers') args.providers = v().split(',');
    else if (k === '--repeat') args.repeat = Number(v());
    else if (k === '--json') args.json = v();
    else if (k === '--cpu-prof') args.cpuProf = true;
    else if (k === '--two-pass') args.twoPass = true;
    else if (k === '--force') args.force = true;
    else throw new Error(`Unknown option ${k}`);
  }
  for (const p of args.providers) {
    if (!(p in PROVIDER_ENUM)) throw new Error(`Unknown provider ${p}`);
  }
  if (!Number.isInteger(args.repeat) || args.repeat < 2) {
    throw new Error('--repeat must be an integer >= 2 (run 0 is the warm-up)');
  }
  return args;
}

function setProvider(provider: AllowedProviders): void {
  try {
    configureProvider(provider);
  } catch (err) {
    if (
      !(err instanceof Error) ||
      !err.message.includes('Provider already configured')
    ) {
      throw err;
    }
    reconfigureProvider(provider);
  }
}

// Process-wide peak RSS, read from the OS high-water mark. A timer-based
// sampler cannot observe synthesis memory: app.synth() is synchronous and
// blocks the event loop, so an interval would never fire during it (and an
// overdue timer can still be beaten by the stop call after the last await).
// process.resourceUsage().maxRSS is the kernel's high-water mark, so it always
// includes the synthesis peak; it is monotonic and process-wide, not per-run.
function peakRssHighWater(): number {
  // ru_maxrss is reported in kilobytes on Linux.
  return process.resourceUsage().maxRSS * 1024;
}

async function timed<T>(fn: () => Promise<T> | T): Promise<[T, number]> {
  const t0 = performance.now();
  const r = await fn();
  return [r, performance.now() - t0];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stats(xs: number[]) {
  if (xs.length === 0) return { min: 0, median: 0, max: 0 };
  return { min: Math.min(...xs), median: median(xs), max: Math.max(...xs) };
}

function resetState(args: Args): void {
  emptyRenderedClaims();
  resetLazyLoader();
  setRenamesEnabled(false);
  setRepositoryUrl(`https://github.com/${args.org}/claims`);
  setDefaultBranch('main');
  setExcludedPaths([]);
  setPath('initializers', args.initializers);
  setPath('crs', args.crs);
  setPath('globals', args.globals);
  setPath('claims', args.claims);
  setPath('claimsDefaults', args.claimsDefaults);
}

interface ProviderTiming {
  renderMs: number;
  synthMs: number;
  renderedCrs: number;
}

interface RunResult {
  run: number;
  discoveryMs: number;
  loadMs: number;
  loadedClaims: number;
  twoPass: Record<string, number>;
  twoPassSkipped: string[];
  providers: Record<string, ProviderTiming>;
}

async function renderProvider(
  provider: string,
  run: number,
  args: Args,
  data: { renderClaims: any; crs: any; fullCrs: any },
  crsOverride?: string,
): Promise<ProviderTiming> {
  // Each provider is its own render pass: clear the shared rendered-claim
  // registry so a claim is not registered twice across providers.
  emptyRenderedClaims();
  resetLazyLoader();
  setProvider(PROVIDER_ENUM[provider]);
  const outDir = path.join(args.out, `run-${run}`, provider);
  const catalogOut = path.join(outDir, 'catalog');
  const crsOut = crsOverride ?? path.join(outDir, 'crs');
  fs.mkdirSync(catalogOut, { recursive: true });
  fs.mkdirSync(crsOut, { recursive: true });
  const catalogApp = Testing.app({
    outdir: catalogOut,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });
  const app = Testing.app({
    outdir: crsOut,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });
  const [rendered, renderMs] = await timed(async () => {
    const crs = await renderClaims(catalogApp, app, data);
    const fullCrSet = { ...data.fullCrs, ...crs };
    validateSubReferences(data.renderClaims);
    validateComponentPagesPath(data.renderClaims);
    validateTfStateKeyUniqueness(crs);
    validateCrSizes(crs);
    validatePermissionsUniqueness(crs);
    validateNoBackstageAnnotationsInK8sCrs(fullCrSet);
    validateGithubOrgSettingsSingleton(fullCrSet);
    validateGithubOrgVariableSectionSingleton(fullCrSet);
    validateActionsVariablesUniqueness(crs);
    return crs;
  });
  // Synthesize both apps inside the timed phase: CRs land in `app`, catalog
  // entities in `catalogApp`. Without the catalog synth a catalog-only pass
  // writes nothing to disk despite reporting rendered entities.
  const [, synthMs] = await timed(() => {
    app.synth();
    catalogApp.synth();
  });
  return { renderMs, synthMs, renderedCrs: Object.keys(rendered).length };
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  process.env.ORG ??= args.org;

  const manifestPath = path.join(
    path.dirname(args.claims),
    'generator-manifest.json',
  );
  let expected: number | null = null;
  let seed: number | null = null;
  let tier: number | null = null;
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expected = manifest.total ?? null;
    seed = manifest.seed ?? null;
    tier = manifest.tier ?? null;
  }

  MOCK_STITCHING_FEATURES(async () => []);
  MOCK_FEATURES(() => ({ files: {}, traceability: {} }));

  assertCanWipe(args.out, [
    REPO,
    args.claims,
    args.globals,
    args.initializers,
    args.claimsDefaults,
    args.crs,
  ]);
  if (
    !args.force &&
    fs.existsSync(args.out) &&
    fs.readdirSync(args.out).length > 0 &&
    !fs.existsSync(path.join(args.out, MARKER))
  ) {
    throw new Error(
      `Refusing to wipe non-empty ${args.out}: it has no ${MARKER} marker. ` +
        'Pass --force to overwrite an existing directory.',
    );
  }

  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, MARKER), 'benchmark output\n');
  fs.mkdirSync(args.crs, { recursive: true });

  console.log(
    `Benchmark: claims=${args.claims} repeats=${args.repeat} ` +
      `providers=${args.providers.join(',')} seed=${seed ?? 'n/a'} tier=${tier ?? 'n/a'}`,
  );

  let profiler: Session | null = null;
  if (args.cpuProf) {
    profiler = new Session();
    profiler.connect();
    profiler.post('Profiler.enable');
    profiler.post('Profiler.start');
  }

  const runs: RunResult[] = [];

  for (let run = 0; run < args.repeat; run++) {
    resetState(args);

    const [refs, discoveryMs] = await timed(async () => {
      const acc: string[] = [];
      for await (const ref of resolveClaimEntries([args.claims])) acc.push(ref);
      return acc;
    });

    async function* refGen() {
      for (const r of refs) yield r;
    }

    const [data, loadMs] = await timed(() =>
      loadClaimsList(refGen(), args.claims),
    );
    const loadedClaims = Object.keys(data.renderClaims).length;

    const providers: Record<string, ProviderTiming> = {};
    for (const p of args.providers) {
      providers[p] = await renderProvider(p, run, args, data);
    }

    // Second pass over each provider that can yield usable previous CRs: reload
    // with that provider's own first-pass output as `crs`, then re-render it so
    // the previousCR path is exercised. Catalog entities are skipped outright by
    // getPreviousCRfromClaim, and providers this claim set has no data for write
    // no CRs at all, so both are reported as skipped instead of silently
    // measuring a pass with no previous CRs.
    const twoPass: Record<string, number> = {};
    const twoPassSkipped: string[] = [];
    if (args.twoPass) {
      for (const p of args.providers) {
        const crsDir = path.join(args.out, `run-${run}`, p, 'crs');
        const usable =
          p !== 'catalog' &&
          fs.existsSync(crsDir) &&
          fs.readdirSync(crsDir).some((f) => /\.ya?ml$/.test(f));
        if (!usable) {
          twoPassSkipped.push(p);
          continue;
        }
        setPath('crs', crsDir);
        const [twoPassData] = await timed(() =>
          loadClaimsList(refGen(), args.claims),
        );
        const pass = await renderProvider(p, run, args, twoPassData, crsDir);
        twoPass[p] = pass.renderMs;
        setPath('crs', args.crs);
      }
    }

    const result: RunResult = {
      run,
      discoveryMs,
      loadMs,
      loadedClaims,
      twoPass,
      twoPassSkipped,
      providers,
    };
    runs.push(result);
    console.log(
      `run ${run}${run === 0 ? ' (warm-up)' : ''}: ` +
        `discover=${result.discoveryMs.toFixed(0)}ms ` +
        `load=${result.loadMs.toFixed(0)}ms ` +
        `claims=${result.loadedClaims}`,
    );
  }

  // The profile is written next to the report, so make the report's directory
  // first; otherwise `--json <new-dir>/report.json --cpu-prof` would throw
  // ENOENT and exit before either artifact is saved.
  fs.mkdirSync(path.dirname(args.json), { recursive: true });

  if (profiler) {
    const profile: any = await new Promise((resolve, reject) => {
      profiler!.post('Profiler.stop', (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    const cpuProfPath = `${args.json.replace(/\.json$/, '')}.cpuprofile`;
    fs.writeFileSync(cpuProfPath, JSON.stringify(profile.profile));
    profiler.disconnect();
    console.log(`CPU profile written to ${cpuProfPath}`);
  }

  const measured = runs.filter((r) => r.run > 0);
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    seed,
    tier,
    org: args.org,
    claimsDir: args.claims,
    expectedClaims: expected,
    repeats: args.repeat,
    warmUpDropped: 1,
    providers: args.providers,
    twoPass: args.twoPass,
    discoveryMs: stats(measured.map((r) => r.discoveryMs)),
    loadMs: stats(measured.map((r) => r.loadMs)),
    loadedClaims: measured[0]?.loadedClaims ?? 0,
    // OS high-water mark: process-wide peak, includes the synthesis peak.
    peakRssBytes: peakRssHighWater(),
    perProvider: Object.fromEntries(
      args.providers.map((p) => {
        const twoPassValues = measured
          .map((r) => r.twoPass[p])
          .filter((v): v is number => typeof v === 'number');
        return [
          p,
          {
            renderMs: stats(measured.map((r) => r.providers[p].renderMs)),
            synthMs: stats(measured.map((r) => r.providers[p].synthMs)),
            renderedCrs: measured[0]?.providers[p].renderedCrs ?? 0,
            twoPassRenderMs: twoPassValues.length ? stats(twoPassValues) : null,
          },
        ];
      }),
    ),
    twoPassSkipped: measured[0]?.twoPassSkipped ?? [],
    rawRuns: runs,
  };

  fs.writeFileSync(args.json, JSON.stringify(report, null, 2) + '\n');

  console.log('\n=== aggregate (warm-up dropped) ===');
  console.log(
    `discover median=${report.discoveryMs.median.toFixed(0)}ms  ` +
      `load median=${report.loadMs.median.toFixed(0)}ms ` +
      `[${report.loadMs.min.toFixed(0)}..${report.loadMs.max.toFixed(0)}]`,
  );
  for (const p of args.providers) {
    const timing = report.perProvider[p];
    console.log(
      `  ${p}: render=${timing.renderMs.median.toFixed(0)}ms ` +
        `synth=${timing.synthMs.median.toFixed(0)}ms ` +
        `crs=${timing.renderedCrs}`,
    );
  }
  if (args.twoPass) {
    const measuredTwoPass = args.providers
      .filter((p) => report.perProvider[p].twoPassRenderMs)
      .map(
        (p) =>
          `${p}=${report.perProvider[p].twoPassRenderMs!.median.toFixed(0)}ms`,
      );
    console.log(
      `  two-pass: ${measuredTwoPass.length ? measuredTwoPass.join(' ') : 'none measured'}` +
        (report.twoPassSkipped.length
          ? ` (skipped: ${report.twoPassSkipped.join(',')})`
          : ''),
    );
  }
  console.log(
    `loaded=${report.loadedClaims}${expected ? `/${expected}` : ''} ` +
      `peakRss=${(report.peakRssBytes / 1024 / 1024).toFixed(0)}MB (process high-water)`,
  );
  console.log(`Report written to ${args.json}`);

  if (expected !== null && report.loadedClaims !== expected) {
    throw new Error(
      `Correctness guard failed: loaded ${report.loadedClaims} claims, expected ${expected}`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
