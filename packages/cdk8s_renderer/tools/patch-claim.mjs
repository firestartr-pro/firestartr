#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import fjp from 'fast-json-patch';
import yaml from 'yaml';

function usage(exitCode = 0) {
  console.error(`Usage: patch-claim.mjs <claim-path> --patch <json> [--patch <json> ...] --flag <modify|clone> [--result-path <path>]

Apply JSON Patch operations to a claim YAML file.

Arguments:
  claim-path            Path to the claim YAML file
  --patch, -p <json>    JSON Patch operation (can be repeated)
  --flag, -f <mode>     Either "modify" (in-place) or "clone" (copy then patch)
  --result-path, -r     Required when --flag is clone; destination path

Examples:
  # Modify in-place
  patch-claim.mjs .tmp_dir/claims/claims/components/component_a.yaml \\
    --patch '{"op":"add","path":"/providers/github/archiveOnDestroy","value":false}' \\
    --flag modify

  # Clone then patch
  patch-claim.mjs .tmp_dir/claims/claims/components/component_a.yaml \\
    --patch '{"op":"replace","path":"/name","value":"test"}' \\
    --flag clone \\
    --result-path .tmp_dir/claims/claims/components/test_a.yaml

  # Multiple patches
  patch-claim.mjs .tmp_dir/claims/claims/groups/group_a.yaml \\
    --patch '{"op":"add","path":"/providers/github/org","value":"myorg"}' \\
    --patch '{"op":"add","path":"/providers/github/privacy","value":"closed"}' \\
    --flag modify`);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage();
}

let claimPath = null;
const patches = [];
let flag = null;
let resultPath = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--patch' || arg === '-p') {
    const raw = args[++i];
    if (!raw) {
      console.error('Error: --patch requires a JSON argument');
      process.exit(1);
    }
    try {
      patches.push(JSON.parse(raw));
    } catch {
      console.error(`Error: invalid JSON for --patch: ${raw}`);
      process.exit(1);
    }
  } else if (arg === '--flag' || arg === '-f') {
    flag = args[++i];
    if (!flag || (flag !== 'modify' && flag !== 'clone')) {
      console.error('Error: --flag must be "modify" or "clone"');
      process.exit(1);
    }
  } else if (arg === '--result-path' || arg === '-r') {
    resultPath = args[++i];
    if (!resultPath) {
      console.error('Error: --result-path requires a path argument');
      process.exit(1);
    }
  } else if (arg.startsWith('-')) {
    console.error(`Error: unknown option ${arg}`);
    usage(1);
  } else if (!claimPath) {
    claimPath = arg;
  } else {
    console.error(`Error: unexpected argument ${arg}`);
    usage(1);
  }
}

if (!claimPath) {
  console.error('Error: claim-path is required');
  usage(1);
}

if (!flag) {
  console.error('Error: --flag is required (modify or clone)');
  usage(1);
}

if (flag === 'clone' && !resultPath) {
  console.error('Error: --result-path is required when --flag is clone');
  usage(1);
}

if (patches.length === 0) {
  console.error('Error: at least one --patch is required');
  usage(1);
}

let targetPath = claimPath;

if (flag === 'clone') {
  fs.mkdirSync(path.dirname(resultPath), {recursive: true});
  fs.copyFileSync(claimPath, resultPath);
  targetPath = resultPath;
  console.log(`Cloned ${claimPath} -> ${resultPath}`);
}

const fileContents = fs.readFileSync(targetPath, 'utf-8');
let claim;

try {
  claim = yaml.parse(fileContents);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: failed to parse YAML at ${targetPath}: ${msg}`);
  process.exit(1);
}

try {
  const result = fjp.applyPatch(claim, patches);
  fs.writeFileSync(targetPath, yaml.stringify(result.newDocument));
  console.log(`Applied ${patches.length} patch(es) to ${targetPath}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: patch application failed: ${msg}`);
  process.exit(1);
}
