import fs from 'fs';
import path from 'path';
import { Testing, YamlOutputType } from 'cdk8s';

import {
  AllowedProviders,
  configureProvider,
  reconfigureProvider,
  setExcludedPaths,
  setPath,
} from '../src/config';
import { resetLazyLoader } from '../src/loader/lazy_loader';
import { render } from '../src/renderer/renderer';
import { emptyRenderedClaims } from '../src/refresolver';
import { resolveClaimEntries } from '../src/utils/claimUtils';

const usage = `
Usage: node tools/render-claims.cjs [options]

Claims (at least one required):
  --claim <path>                Path to a claim YAML file (repeatable)

Provider (at least one required):
  --provider <name>             Provider: all | catalog | github | terraform | argocd | externalSecrets (repeatable)
  --all-providers               Shortcut for --provider all

Output directories:
  --catalog-out <path>          Catalog CR output dir (default: .tmp_dir/catalog)
  --crs-out <path>              Firestartr CR output dir
                                (default: github -> .tmp_dir/state-github,
                                 externalSecrets -> .tmp_dir/state-secrets,
                                 others -> .tmp_dir/state_infra)

Renderer paths:
  --globals-dir <path>          Globals path (default: __tests__/fixtures/globals)
  --initializers-dir <path>     Initializers path (default: __tests__/fixtures/initializers)
  --crs-dir <path>              Previous CRs path (default: __tests__/fixtures/crs)
  --exclude-github-crs          Exclude .github CRs path
  --help                        Show this help

Examples:
  node tools/render-claims.cjs \\
    --claim ../../.tmp_dir/claims/claims/groups/group_a.yaml \\
    --provider all
  node tools/render-claims.cjs \\
    --claim ../../.tmp_dir/claims/claims/groups/group_a.yaml \\
    --provider github --crs-out ../../.tmp_dir/state-github
  node tools/render-claims.cjs \\
    --claim ../../.tmp_dir/claims/claims/components/component_a.yaml \\
    --provider all
`;

const CLAIM_TYPE_DIRS = new Set([
  'components',
  'groups',
  'users',
  'systems',
  'domains',
  'secrets',
  'tfworkspaces',
  'argocd',
  'orgWebhook',
  'features',
]);

function inferClaimsRoot(filePath: string): string {
  const dir = path.dirname(filePath);
  const parent = path.dirname(dir);
  const dirName = path.basename(dir);
  if (CLAIM_TYPE_DIRS.has(dirName)) {
    return parent;
  }
  return dir;
}

type Args = {
  claims: string[];
  providers: string[];
  catalogOut: string;
  crsOut: string | null;
  globalsDir: string;
  initializersDir: string;
  crsDir: string;
  excludeGithubCrs: boolean;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);

  if (raw.includes('--help') || raw.includes('-h') || raw.length === 0) {
    console.log(usage);
    process.exit(0);
  }

  const claims: string[] = [];
  const providers: string[] = [];
  let catalogOut = '../../.tmp_dir/catalog';
  let crsOut: string | null = null;
  let globalsDir = '__tests__/fixtures/globals';
  let initializersDir = '__tests__/fixtures/initializers';
  let crsDir = '__tests__/fixtures/crs';
  let excludeGithubCrs = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    const next = () => {
      const v = raw[++i];
      if (!v) {
        console.error(`Error: missing value after ${arg}`);
        console.log(usage);
        process.exit(1);
      }
      return v;
    };
    switch (arg) {
      case '--claim':
        claims.push(next());
        break;
      case '--provider':
        providers.push(next());
        break;
      case '--all-providers':
        providers.push('all');
        break;
      case '--catalog-out':
        catalogOut = next();
        break;
      case '--crs-out':
        crsOut = next();
        break;
      case '--globals-dir':
        globalsDir = next();
        break;
      case '--initializers-dir':
        initializersDir = next();
        break;
      case '--crs-dir':
        crsDir = next();
        break;
      case '--exclude-github-crs':
        excludeGithubCrs = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Error: unknown option ${arg}`);
          console.log(usage);
          process.exit(1);
        }
    }
  }

  if (claims.length === 0) {
    console.error('Error: at least one --claim is required');
    console.log(usage);
    process.exit(1);
  }

  if (providers.length === 0) {
    console.error(
      'Error: at least one --provider or --all-providers is required',
    );
    console.log(usage);
    process.exit(1);
  }

  if (providers.includes('all') && providers.length > 1) {
    // 'all' supersedes any specific provider selections
    providers.splice(0, providers.length, 'all');
  }
  return {
    claims,
    providers,
    catalogOut,
    crsOut,
    globalsDir,
    initializersDir,
    crsDir,
    excludeGithubCrs,
  };
}

function writeLog(msg: string) {
  console.log(msg);
  try {
    const logFile = path.resolve(process.cwd(), '../../.tmp_dir/render.log');
    fs.appendFileSync(logFile, msg + '\n');
  } catch {
    // swallow — log file write is best-effort
  }
}

function checkEnv() {
  if (!process.env.ORG) {
    process.env.ORG = 'firestartr-test';
    console.log('ORG not set, defaulting to firestartr-test');
  }
  if (!process.env.PREFAPP_BOT_PAT) {
    const tokenPath = path.resolve(process.cwd(), '../../.tmp_dir/.token');
    if (fs.existsSync(tokenPath)) {
      process.env.PREFAPP_BOT_PAT = fs.readFileSync(tokenPath, 'utf-8').trim();
      console.log(`Loaded PREFAPP_BOT_PAT from ${tokenPath}`);
    } else {
      console.warn(
        'Warning: PREFAPP_BOT_PAT is not set and .tmp_dir/.token not found. No features test can be performed. Write the token to .tmp_dir/.token or export PREFAPP_BOT_PAT.',
      );
    }
  }
}

function resolveProvider(p: string): AllowedProviders {
  switch (p) {
    case 'all':
      return AllowedProviders.all;
    case 'catalog':
      return AllowedProviders.catalog;
    case 'github':
      return AllowedProviders.github;
    case 'az':
      return AllowedProviders.az;
    case 'terraform':
      return AllowedProviders.terraform;
    case 'argocd':
      return AllowedProviders.argocd;
    case 'externalSecrets':
      return AllowedProviders.externalSecrets;
    default:
      console.error(`Error: invalid --provider value "${p}"`);
      console.log(usage);
      process.exit(1);
  }
}

function setProvider(p: AllowedProviders) {
  try {
    configureProvider(p);
  } catch (err) {
    // Only the already-configured case is expected here; any other
    // configuration error must surface instead of being silently hidden.
    if (
      !(err instanceof Error) ||
      !err.message.includes('Provider already configured')
    ) {
      throw err;
    }
    reconfigureProvider(p);
  }
}

type RenderPass = {
  provider: AllowedProviders;
  label: string;
  crsOut: string;
};

function planPasses(
  providers: string[],
  crsOutOverride: string | null,
): RenderPass[] {
  // If --crs-out was explicitly set, use it for a single pass with the given providers
  if (crsOutOverride) {
    const p =
      providers.includes('all') || providers.length > 1
        ? AllowedProviders.all
        : resolveProvider(providers[0]);
    return [
      { provider: p, label: providers.join('+'), crsOut: crsOutOverride },
    ];
  }

  // --provider all => split into separate passes per provider domain
  if (providers.includes('all') || providers.length > 1) {
    const passes: RenderPass[] = [];
    const seen = new Set<string>();
    for (const p of providers.length === 1 && providers[0] === 'all'
      ? ['catalog', 'github', 'terraform', 'externalSecrets', 'argocd']
      : providers) {
      if (seen.has(p)) continue;
      seen.add(p);
      switch (p) {
        case 'github':
          passes.push({
            provider: AllowedProviders.github,
            label: 'github',
            crsOut: '../../.tmp_dir/state-github',
          });
          break;
        case 'externalSecrets':
          passes.push({
            provider: AllowedProviders.externalSecrets,
            label: p,
            crsOut: '../../.tmp_dir/state-secrets',
          });
          break;
        case 'terraform':
        case 'argocd':
          passes.push({
            provider: resolveProvider(p),
            label: p,
            crsOut: '../../.tmp_dir/state_infra',
          });
          break;
        case 'catalog':
          passes.push({
            provider: AllowedProviders.catalog,
            label: 'catalog',
            crsOut: '../../.tmp_dir/state_infra',
          });
          break;
      }
    }
    return passes;
  }

  // Single provider
  const p = providers[0];
  const crsOut =
    p === 'github'
      ? '../../.tmp_dir/state-github'
      : p === 'externalSecrets'
        ? '../../.tmp_dir/state-secrets'
        : '../../.tmp_dir/state_infra';
  return [{ provider: resolveProvider(p), label: p, crsOut }];
}

async function runPass(
  pass: RenderPass,
  cwd: string,
  claimPaths: string[],
  claimsRoot: string,
  catalogOut: string,
  globalsDir: string,
  initializersDir: string,
  crsDir: string,
  excludeGithubCrs: boolean,
): Promise<number> {
  setProvider(pass.provider);
  emptyRenderedClaims();
  resetLazyLoader();

  setPath('initializers', initializersDir);
  setPath('crs', crsDir);
  setPath('globals', globalsDir);
  setPath('claims', claimsRoot);
  const claimsDefaultsDir = path.join(path.dirname(claimsRoot), '.config');
  setPath(
    'claimsDefaults',
    fs.existsSync(path.join(claimsDefaultsDir, 'claims_defaults.yaml'))
      ? claimsDefaultsDir
      : initializersDir,
  );

  if (excludeGithubCrs) {
    setExcludedPaths([path.join(crsDir, '.github')]);
  }

  const resolve = (p: string) =>
    path.isAbsolute(p) ? p : path.resolve(cwd, p);
  const passCrsOut = resolve(pass.crsOut);

  const catalogApp = Testing.app({
    outdir: catalogOut,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  const app = Testing.app({
    outdir: passCrsOut,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  const claimSource = await resolveClaimEntries(claimPaths);
  writeLog(`  [${pass.label}] rendering...`);
  const renderedMap = await render(catalogApp, app, claimSource);

  app.synth();
  catalogApp.synth();

  const crsFiles = fs.existsSync(passCrsOut)
    ? fs.readdirSync(passCrsOut).length
    : 0;
  writeLog(
    `  [${pass.label}] done — ${Object.keys(renderedMap).length} CRs -> ${passCrsOut} (${crsFiles} files)`,
  );

  return Object.keys(renderedMap).length;
}

async function main() {
  const args = parseArgs();
  checkEnv();

  const cwd = process.cwd();
  const resolve = (p: string) =>
    path.isAbsolute(p) ? p : path.resolve(cwd, p);

  const claimPaths = args.claims.map(resolve);
  const claimsRoot = inferClaimsRoot(claimPaths[0]);
  const catalogOut = resolve(args.catalogOut);
  const globalsDir = resolve(args.globalsDir);
  const initializersDir = resolve(args.initializersDir);
  const crsDir = resolve(args.crsDir);

  const passes = planPasses(args.providers, args.crsOut);

  console.log('Configured renderer:');
  for (const c of claimPaths) console.log(`  claim:    ${c}`);
  console.log(`  claims root: ${claimsRoot}`);
  console.log(`  globals:   ${globalsDir}`);
  console.log(`  initializers: ${initializersDir}`);
  console.log(`  crs:       ${crsDir}`);
  console.log(`  catalog:   ${catalogOut}`);
  console.log(
    `  passes:    ${passes.map((p) => `${p.label}->${p.crsOut}`).join(', ')}`,
  );

  let total = 0;
  for (const pass of passes) {
    total += await runPass(
      pass,
      cwd,
      claimPaths,
      claimsRoot,
      catalogOut,
      globalsDir,
      initializersDir,
      crsDir,
      args.excludeGithubCrs,
    );
  }

  const catalogFiles = fs.existsSync(catalogOut)
    ? fs.readdirSync(catalogOut).length
    : 0;
  console.log(`\nDone. Rendered ${total} CRs total.`);
  console.log(`  catalog: ${catalogOut} (${catalogFiles} files)`);
}

main().catch((err) => {
  console.error(`Render failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
