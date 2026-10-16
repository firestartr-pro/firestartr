// Render benchmark harness for cdk8s_renderer.
//
// Drives the renderer only through its public API and times each phase
// (discover, load, render+validate, synth) around it, with a peak-RSS sampler
// and optional CPU profiling. Fully offline: stitching and feature overrides
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

let peakRss = 0;
let sampler: NodeJS.Timeout | null = null;
function startRss(): void {
  peakRss = 0;
  sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  }, 25);
}
function stopRss(): number {
  if (sampler) clearInterval(sampler);
  sampler = null;
  return peakRss;
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
  peakRssBytes: number;
  twoPassRenderMs: number | null;
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
  const [, synthMs] = await timed(() => app.synth());
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

  MOCK_STITCHING_FEATURES(() => []);
  MOCK_FEATURES(() => ({ files: {}, traceability: {} }));

  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(args.out, { recursive: true });
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
    startRss();

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

    let twoPassRenderMs: number | null = null;
    if (args.twoPass && args.providers.length > 0) {
      // Re-load with the CRs produced above as previous CRs, then re-render.
      const first = args.providers[0];
      const producedCrs = path.join(args.out, `run-${run}`, first, 'crs');
      setPath('crs', producedCrs);
      const [twoPassData] = await timed(() =>
        loadClaimsList(refGen(), args.claims),
      );
      const pass = await renderProvider(
        first,
        run,
        args,
        twoPassData,
        producedCrs,
      );
      twoPassRenderMs = pass.renderMs;
      setPath('crs', args.crs);
    }

    const result: RunResult = {
      run,
      discoveryMs,
      loadMs,
      loadedClaims,
      peakRssBytes: stopRss(),
      twoPassRenderMs,
      providers,
    };
    runs.push(result);
    console.log(
      `run ${run}${run === 0 ? ' (warm-up)' : ''}: ` +
        `discover=${result.discoveryMs.toFixed(0)}ms ` +
        `load=${result.loadMs.toFixed(0)}ms ` +
        `claims=${result.loadedClaims} ` +
        `peakRss=${(result.peakRssBytes / 1024 / 1024).toFixed(0)}MB`,
    );
  }

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
    peakRssBytes: Math.max(...measured.map((r) => r.peakRssBytes)),
    perProvider: Object.fromEntries(
      args.providers.map((p) => [
        p,
        {
          renderMs: stats(measured.map((r) => r.providers[p].renderMs)),
          synthMs: stats(measured.map((r) => r.providers[p].synthMs)),
          renderedCrs: measured[0]?.providers[p].renderedCrs ?? 0,
        },
      ]),
    ),
    twoPassRenderMs: stats(
      measured
        .map((r) => r.twoPassRenderMs)
        .filter((v): v is number => v !== null),
    ),
    rawRuns: runs,
  };

  fs.mkdirSync(path.dirname(args.json), { recursive: true });
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
  console.log(
    `loaded=${report.loadedClaims}${expected ? `/${expected}` : ''} ` +
      `peakRss=${(report.peakRssBytes / 1024 / 1024).toFixed(0)}MB`,
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
