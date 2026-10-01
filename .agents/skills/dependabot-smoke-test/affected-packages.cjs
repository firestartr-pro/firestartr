#!/usr/bin/env node
// Usage: node affected-packages.cjs <PR-number>
// Prints one affected workspace package name per line.
// A package is affected if:
//   - its packages/<name>/package.json appears in the PR diff (direct), or
//   - it has a file:../<direct> workspace dependency (transitive).
// If no workspace packages/<name>/package.json changed (root-level bump, e.g. only
// package-lock.json or root package.json changed), all workspace packages are printed.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pr = process.argv[2];
if (!pr) { console.error('Usage: node affected-packages.cjs <PR-number>'); process.exit(1); }
if (!/^[1-9]\d*$/.test(pr)) { console.error('Error: PR number must be a positive integer, got: ' + pr); process.exit(1); }

const changedFiles = JSON.parse(
  execSync(`gh pr view ${pr} --json files --jq '[.files[].path]'`).toString().trim()
);

const pkgDirs = fs.readdirSync('packages').filter(d => {
  try { return fs.statSync(path.join('packages', d, 'package.json')).isFile(); } catch { return false; }
});

const hasWorkspacePkg = changedFiles.some(
  f => f.startsWith('packages/') && f.endsWith('package.json')
);

if (!hasWorkspacePkg) {
  // root-level bump — all packages affected
  pkgDirs.forEach(d => console.log(d));
  process.exit(0);
}

const direct = pkgDirs.filter(d => changedFiles.includes(`packages/${d}/package.json`));

const transitive = pkgDirs.filter(d => {
  if (direct.includes(d)) return false;
  const raw = JSON.parse(fs.readFileSync(path.join('packages', d, 'package.json')));
  const deps = { ...raw.dependencies, ...raw.devDependencies };
  return Object.values(deps).some(v => direct.some(dp => v === `file:../${dp}`));
});

[...new Set([...direct, ...transitive])].forEach(d => console.log(d));
