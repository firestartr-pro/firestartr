#!/usr/bin/env node
// Seeded claims-directory generator for cdk8s_renderer stress testing.
//
// Produces a self-contained claims directory (claims + globals + initializers +
// claims_defaults) whose every claim is emitted by one `fs-forge create <kind>`
// spawn, so the CLI stays the single source of truth for claim shape. Fully
// offline: `create` without `--commit` only validates and prints the claim.
//
// The fs-forge CLI needs `dist/`, which is not built in-tree, so this script
// writes a tiny launcher into the (gitignored) output directory that runs the
// CLI from its TypeScript sources via tsx. Nothing is written into the repo.
//
// Usage:
//   node tools/generate-claims.mjs [--out DIR] [--tier N] [--seed N]
//                                  [--jobs N] [--org NAME] [--help]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO = path.resolve(PKG_ROOT, '..', '..');
const TMP_DIR = path.join(REPO, '.tmp_dir');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
const CLI_DIR = path.join(REPO, 'packages', 'fs-forge-cli');
const DEFAULT_OUT = path.join(REPO, '.tmp_dir', 'bench');
const TIERS = [100, 1000, 10000];
const MIN_TIER = 10;
const MARKER = '.bench-owned';

// Resolve a path to its real location, following symlinks, even when the leaf
// does not exist yet: realpath the deepest existing ancestor and re-append the
// remaining segments. This makes alias endpoints (symlinked parents) compare
// equal to the directory they really point at.
function canonicalize(p) {
  let existing = path.resolve(p);
  const tail = [];
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
    // Keep the resolved path if realpath fails.
  }
  return path.join(real, ...tail);
}

// True when `child` is `parent` or lives under it. A `..`-prefixed name like
// `..backup` is a valid child, so only the exact `..` segment (or `..` +
// separator) counts as escaping the parent.
function contains(parent, child) {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  if (rel === '' || path.isAbsolute(rel)) return false;
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return false;
  return true;
}

// Never wipe an output directory that holds a source or input we depend on.
// Not overridable: even `--force` must not be able to delete the repo.
//
// Two rules:
//   1. The repository is off-limits. `--out` may not contain it, and if `--out`
//      lives inside it, it must be under the gitignored scratch root
//      (`<repo>/.tmp_dir`). Only that subtree is wipable in-repo.
//   2. Each configured input is refused in both directions, so rendered output
//      can never be written back into an input tree (nor an input deleted).
function assertCanWipe(out, inputPaths) {
  const outReal = canonicalize(out);
  const repoReal = canonicalize(REPO);
  if (contains(outReal, repoReal)) {
    throw new Error(
      `Refusing to wipe ${out}: it contains the repository (${REPO}). ` +
        'Choose an --out outside the repo.',
    );
  }
  if (contains(repoReal, outReal) && !contains(canonicalize(TMP_DIR), outReal)) {
    throw new Error(
      `Refusing to wipe ${out}: it lives inside the repository but outside ` +
        `${TMP_DIR}. Only the scratch directory is wipable in-repo.`,
    );
  }
  for (const input of inputPaths) {
    const inReal = canonicalize(input);
    if (contains(outReal, inReal) || contains(inReal, outReal)) {
      throw new Error(
        `Refusing to wipe ${out}: it overlaps the input ${input}. ` +
          'Choose an --out outside every input.',
      );
    }
  }
}

const usage = `
Usage: node tools/generate-claims.mjs [options]

Options:
  --out <dir>     Output bench directory (default: <repo>/.tmp_dir/bench)
  --tier <n>      Total claim count. Canonical sizes: ${TIERS.join(', ')}
                  (default: 1000). Any integer >= ${MIN_TIER} is accepted
                  so tests can use a small tree.
  --seed <n>      PRNG seed; same seed+tier is byte-identical (default: 80)
  --jobs <n>      Concurrent fs-forge spawns (default: 8)
  --org <name>    GitHub org used in provider fields (default: bench).
                  Lowercase alphanumeric (inner ".", "_", "-"), <= 51 chars.
  --force         Wipe a non-empty --out that lacks the ${MARKER} marker
  --help          Show this help

Output layout:
  <out>/claims/{components,groups,users,systems,domains,orgSettings}/
  <out>/globals/                     copy of __tests__/fixtures/globals
  <out>/initializers/                copy of __tests__/fixtures/initializers
  <out>/.config/claims_defaults.yaml
  <out>/generator-manifest.json
`;

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    tier: 1000,
    seed: 80,
    jobs: 8,
    org: 'bench',
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value after ${a}`);
      return v;
    };
    if (a === '--help' || a === '-h') {
      console.log(usage);
      process.exit(0);
    } else if (a === '--out') args.out = next();
    else if (a === '--tier') args.tier = Number(next());
    else if (a === '--seed') args.seed = Number(next());
    else if (a === '--jobs') args.jobs = Number(next());
    else if (a === '--org') args.org = next();
    else if (a === '--force') args.force = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!Number.isInteger(args.tier) || args.tier < MIN_TIER) {
    throw new Error(
      `--tier must be an integer >= ${MIN_TIER} (canonical: ${TIERS.join(', ')})`,
    );
  }
  if (!Number.isInteger(args.seed)) throw new Error('--seed must be an integer');
  if (!Number.isInteger(args.jobs) || args.jobs < 1) {
    throw new Error('--jobs must be a positive integer');
  }
  // Match the claim schemas' name/org pattern (fs-forge validates these on
  // every spawned `create`), and keep `orgsettings-<org>` within the 63-char
  // claim-name limit (12-char prefix => org <= 51). Validating here, before
  // the wipe and any spawn, preserves an existing fixture on bad input.
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(args.org)) {
    throw new Error(
      `Invalid --org: ${args.org}. Must be lowercase alphanumeric with ` +
        'internal ".", "_" or "-" and start/end alphanumeric.',
    );
  }
  if (`orgsettings-${args.org}`.length > 63) {
    throw new Error(
      `Invalid --org: ${args.org} is too long (${args.org.length} chars); ` +
        '`orgsettings-<org>` must fit within 63 characters (max 51).',
    );
  }
  return args;
}

// Deterministic PRNG so a seed reproduces the exact wiring (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (i, w = 4) => String(i).padStart(w, '0');

// Offline feature catalog: name, version and args for providers.github.features.
const FEATURE_CATALOG = [
  { name: 'tech_docs', version: '1.0.0', args: {} },
  { name: 'feature_a', version: '1.2.0', args: { level: 'basic' } },
  { name: 'feature_b', version: '2.0.0', args: {} },
  { name: 'feature_c', version: '1.0.0', args: { enabled: true } },
  { name: 'feature_d', version: '3.1.0', args: {} },
];

function planCounts(tier) {
  // Weights sum to 0.9; orgSettings gets 1. A minimum of one of each non-singleton
  // kind keeps small test tiers valid, and the remainder folds into components so
  // the per-kind counts always sum to the tier exactly.
  const weights = [
    ['component', 0.3],
    ['user', 0.3],
    ['group', 0.15],
    ['system', 0.1],
    ['domain', 0.05],
  ];
  const remaining = tier - 1;
  const counts = { orgSettings: 1 };
  let allocated = 0;
  for (const [kind, w] of weights) {
    counts[kind] = Math.max(1, Math.round(remaining * w));
    allocated += counts[kind];
  }
  if (allocated > remaining) {
    // Very small tiers: trim components first, then clamp each kind to 1.
    counts.component = Math.max(1, counts.component - (allocated - remaining));
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.component += tier - total;
  return counts;
}

function buildPlan(args) {
  const counts = planCounts(args.tier);
  const rng = mulberry32(args.seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const pickN = (arr, n) => {
    const set = new Set();
    let guard = 0;
    while (set.size < n && guard++ < n * 20) set.add(pick(arr));
    return [...set];
  };

  const names = (kind, n) =>
    Array.from({ length: n }, (_, i) => `${kind}-${pad(i + 1)}`);

  const userNames = names('user', counts.user);
  const groupNames = names('group', counts.group);
  const domainNames = names('domain', counts.domain);
  const systemNames = names('system', counts.system);
  const componentNames = names('component', counts.component);

  // Hub-heavy fan-out: a minority of components provide several APIs, and
  // consumers draw mostly from that hot set. Every consumed API is provided.
  const hubCount = Math.max(1, Math.ceil(componentNames.length * 0.15));
  const hubs = componentNames.slice(0, hubCount);
  const providers = []; // { component, apis: string[] }
  componentNames.forEach((component, i) => {
    const isHub = hubs.includes(component);
    const apisFor =
      isHub ? 1 + Math.floor(rng() * 3) : rng() < 0.1 ? 1 : 0;
    if (apisFor === 0) return;
    providers.push({
      component,
      apis: Array.from(
        { length: apisFor },
        (_, n) => `${component}-api-${n + 1}`,
      ),
    });
  });
  const hotApis = providers
    .filter((p) => hubs.includes(p.component))
    .flatMap((p) => p.apis.map((api) => ({ api, component: p.component })));
  const allApis = providers.flatMap((p) =>
    p.apis.map((api) => ({ api, component: p.component })),
  );
  if (allApis.length === 0) allApis.push({ api: `${hubs[0]}-api-1`, component: hubs[0] });

  const rngInt = (max) => Math.floor(rng() * max);

  const jobs = [];

  for (const name of domainNames) {
    jobs.push({
      plural: 'domains',
      name,
      flags: [
        'create', 'domain',
        '--name', name,
        '--description', `domain ${name}`,
        '--owner', `group:${pick(groupNames)}`,
      ],
    });
  }

  for (const name of systemNames) {
    jobs.push({
      plural: 'systems',
      name,
      flags: [
        'create', 'system',
        '--name', name,
        '--domain', `domain:${pick(domainNames)}`,
        '--owner', `group:${pick(groupNames)}`,
      ],
    });
  }

  for (const name of userNames) {
    jobs.push({
      plural: 'users',
      name,
      flags: [
        'create', 'user',
        '--name', name,
        '--providers.github.name', `${name}-gh`,
        '--providers.github.org', args.org,
        '--providers.github.role', rng() < 0.1 ? 'admin' : 'member',
      ],
    });
  }

  const groupJobs = [];
  for (const name of groupNames) {
    const memberCount = 2 + rngInt(4);
    const flags = [
      'create', 'group',
      '--name', name,
      '--providers.github.name', name,
      '--providers.github.org', args.org,
      '--providers.github.privacy', 'closed',
    ];
    for (const member of pickN(userNames, Math.min(memberCount, userNames.length))) {
      flags.push('--members', `user:${member}`);
    }
    const job = { plural: 'groups', name, flags };
    groupJobs.push(job);
    jobs.push(job);
  }
  // Sparse, acyclic parent links pointing at an earlier group.
  groupJobs.forEach((job, i) => {
    if (i >= 5 && i % 5 === 4) job.flags.push('--parent', `group:${groupNames[i - 5]}`);
  });

  for (const name of componentNames) {
    // Repository permissions grant owner and platformOwner `admin` and each
    // maintainedBy group `maintain`. The same group in both roles makes the
    // permission-uniqueness validation fail, so keep maintainedBy distinct from
    // both and drop it entirely when no other group is available.
    const owner = pick(groupNames);
    const platformOwner = pick(groupNames);
    const maintainers = groupNames.filter(
      (g) => g !== owner && g !== platformOwner,
    );
    const featureCount = rngInt(Math.min(4, FEATURE_CATALOG.length) + 1);
    const flags = [
      'create', 'component',
      '--name', name,
      '--type', 'service',
      '--lifecycle', 'production',
      '--description', `component ${name}`,
      '--owner', `group:${owner}`,
      '--system', `system:${pick(systemNames)}`,
      '--platformOwner', `group:${platformOwner}`,
      '--providers.github.name', name,
      '--providers.github.org', args.org,
      '--providers.github.visibility', 'private',
      '--providers.github.branchStrategy.name', 'trunkBasedDevelopment',
      '--providers.github.branchStrategy.defaultBranch', 'main',
    ];
    if (maintainers.length > 0) {
      flags.push('--maintainedBy', `group:${pick(maintainers)}`);
    }
    const owned = providers.find((p) => p.component === name);
    if (owned) {
      flags.push(
        '--providesApis.json',
        JSON.stringify(
          owned.apis.map((api) => ({
            name: api,
            definitionfile: 'openapi.yaml',
            type: 'openapi',
          })),
        ),
      );
    }
    // Consumers pull mostly from the hot hub set; never from their own APIs.
    const pool = rng() < 0.7 ? hotApis : allApis;
    const consumeCount = rngInt(3);
    const chosen = new Set();
    for (const { api, component } of pickN(pool, Math.min(consumeCount, pool.length))) {
      if (component !== name) chosen.add(api);
    }
    for (const api of chosen) flags.push('--consumesApis', api);
    for (const feature of pickN(
      FEATURE_CATALOG,
      Math.min(featureCount, FEATURE_CATALOG.length),
    )) {
      flags.push(
        '--feature',
        `${feature.name}@${feature.version}:${JSON.stringify(feature.args)}`,
      );
    }
    jobs.push({ plural: 'components', name, flags });
  }

  jobs.push({
    plural: 'orgSettings',
    name: `orgsettings-${args.org}`,
    flags: [
      'create', 'orgsettings',
      '--name', `orgsettings-${args.org}`,
      '--providers.github.name', args.org,
      '--providers.github.org', args.org,
      '--providers.github.billing_email', 'billing@example.com',
    ],
  });

  return jobs;
}

const LAUNCHER = `#!/usr/bin/env node
// Generated by tools/generate-claims.mjs. Runs the fs-forge CLI from its
// TypeScript sources, bypassing the committed oclif.manifest.json (which points
// at a non-existent dist/). Nothing is written into the repo.
import { createRequire } from 'node:module';

const REPO = ${JSON.stringify(REPO)};
const CLI_DIR = ${JSON.stringify(CLI_DIR)};
const req = createRequire(REPO + '/package.json');

const { Plugin } = req(REPO + '/node_modules/@oclif/core/lib/config/plugin.js');
const load = Plugin.prototype.load;
Plugin.prototype.load = function (...args) {
  this.options = { ...this.options, ignoreManifest: true };
  return load.apply(this, args);
};

const { execute } = req('@oclif/core');
await execute({ development: true, dir: CLI_DIR });
`;

function spawnCreate(launcher, job) {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [launcher, ...job.flags], {
      cwd: CLI_DIR,
      env: { ...process.env, NODE_ENV: 'development' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `fs-forge ${job.flags.join(' ')} failed (exit ${code}):\n${err}`,
          ),
        );
      } else {
        resolve(out);
      }
    });
  });
}

function copyFixture(relDir, destDir) {
  const src = path.join(PKG_ROOT, '__tests__', 'fixtures', relDir);
  if (!fs.existsSync(src)) throw new Error(`Missing fixture directory: ${src}`);
  fs.cpSync(src, destDir, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args.out);

  if (!fs.existsSync(TSX)) throw new Error(`tsx not found at ${TSX}`);
  if (!fs.existsSync(path.join(CLI_DIR, 'package.json'))) {
    throw new Error(`fs-forge-cli not found at ${CLI_DIR}`);
  }

  // Every input this tool reads (fixtures, the CLI, tsx) lives in the repo, so
  // the in-repo rule covers them; there are no external inputs to list.
  assertCanWipe(out, []);
  if (
    !args.force &&
    fs.existsSync(out) &&
    fs.readdirSync(out).length > 0 &&
    !fs.existsSync(path.join(out, MARKER))
  ) {
    throw new Error(
      `Refusing to wipe non-empty ${out}: it has no ${MARKER} marker. ` +
        'Pass --force to overwrite an existing directory.',
    );
  }

  console.log(
    `Generating claims: tier=${args.tier} seed=${args.seed} jobs=${args.jobs} org=${args.org}`,
  );
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, MARKER), 'benchmark output\n');

  const launcher = path.join(out, '.fs-forge-launcher.mjs');
  fs.writeFileSync(launcher, LAUNCHER);

  const plan = buildPlan(args);
  const counts = {};
  for (const job of plan) counts[job.plural] = (counts[job.plural] || 0) + 1;
  console.log('Planned:', JSON.stringify(counts), `total=${plan.length}`);

  const claimsRoot = path.join(out, 'claims');
  for (const plural of new Set(plan.map((j) => j.plural))) {
    fs.mkdirSync(path.join(out, 'claims', plural), { recursive: true });
  }

  let done = 0;
  let next = 0;
  const workers = Array.from({ length: Math.min(args.jobs, plan.length) }, async () => {
    while (next < plan.length) {
      const job = plan[next++];
      const yaml = await spawnCreate(launcher, job);
      fs.writeFileSync(path.join(out, 'claims', job.plural, `${job.name}.yaml`), yaml);
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${plan.length}`);
    }
  });
  await Promise.all(workers);

  copyFixture('globals', path.join(out, 'globals'));
  copyFixture('initializers', path.join(out, 'initializers'));
  fs.mkdirSync(path.join(out, '.config'), { recursive: true });
  fs.copyFileSync(
    path.join(out, 'initializers', 'claims_defaults.yaml'),
    path.join(out, '.config', 'claims_defaults.yaml'),
  );

  const perKind = {};
  let total = 0;
  for (const [plural, expected] of Object.entries(
    plan.reduce((acc, job) => {
      acc[job.plural] = (acc[job.plural] ?? 0) + 1;
      return acc;
    }, {}),
  )) {
    const actual = fs
      .readdirSync(path.join(out, 'claims', plural))
      .filter((f) => /\.ya?ml$/.test(f)).length;
    if (actual !== expected) {
      throw new Error(`MISMATCH ${plural}: expected ${expected}, got ${actual}`);
    }
    perKind[plural] = actual;
    total += actual;
  }

  fs.writeFileSync(
    path.join(out, 'generator-manifest.json'),
    JSON.stringify(
      { seed: args.seed, tier: args.tier, org: args.org, perKind, total },
      null,
      2,
    ) + '\n',
  );

  console.log(`Done. ${total} claims written to ${path.join(out, 'claims')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
