#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function usage(exitCode = 0) {
  console.error(`Usage: tf-dummies-ctl.cjs --count <n> [options]

Generate FirestartrTerraformWorkspace dummy CR YAML files using prefapp/tfm//modules/dummy.

Options:
  --count, -n            Number of CRs to generate (required)
  --policy               firestartr.dev/policy annotation value (default: apply)
  --sync-policy          firestartr.dev/sync-policy annotation value (default: apply)
  --crash-on-plan        Plan phase exits non-zero (default: false)
  --crash-on-apply       Apply phase exits non-zero (default: false)
  --tries-before-plan-ok Plan fails N times then succeeds (default: 0)
  --tries-before-apply-ok Apply fails N times then succeeds (default: 0)
  --sleep-on-plan        Seconds to sleep during plan (default: 0)
  --sleep-on-apply       Seconds to sleep during apply (default: 0)
  --help, -h             Show this help

Examples:
  tf-dummies-ctl.cjs -n 3
  tf-dummies-ctl.cjs -n 5 --crash-on-apply true --tries-before-apply-ok 2 --sleep-on-apply 10
  tf-dummies-ctl.cjs -n 3 --policy observe --sync-policy apply`);

  process.exit(exitCode);
}

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
  }

  const opts = {
    count: null,
    policy: 'apply',
    syncPolicy: 'apply',
    crashOnPlan: false,
    crashOnApply: false,
    triesBeforePlanOk: 0,
    triesBeforeApplyOk: 0,
    sleepOnPlan: 0,
    sleepOnApply: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--count':
      case '-n':
        opts.count = parseInt(args[++i], 10);
        break;
      case '--policy':
        opts.policy = args[++i];
        break;
      case '--sync-policy':
        opts.syncPolicy = args[++i];
        break;
      case '--crash-on-plan':
        opts.crashOnPlan = args[++i] === 'true';
        break;
      case '--crash-on-apply':
        opts.crashOnApply = args[++i] === 'true';
        break;
      case '--tries-before-plan-ok':
        opts.triesBeforePlanOk = parseInt(args[++i], 10);
        break;
      case '--tries-before-apply-ok':
        opts.triesBeforeApplyOk = parseInt(args[++i], 10);
        break;
      case '--sleep-on-plan':
        opts.sleepOnPlan = parseInt(args[++i], 10);
        break;
      case '--sleep-on-apply':
        opts.sleepOnApply = parseInt(args[++i], 10);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        usage(1);
    }
  }

  if (!opts.count || isNaN(opts.count) || opts.count < 1) {
    console.error('Error: --count must be a positive integer');
    process.exit(1);
  }

  return opts;
}

function uuid() {
  return crypto.randomUUID();
}

function generateProviderConfig() {
  return {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrProviderConfig',
    metadata: {
      name: 'kubernetes-backend',
      namespace: 'default',
    },
    spec: {
      config: '{"namespace":"default"}',
      source: 'hashicorp/kubernetes',
      type: 'kubernetes',
      version: '3.0.1',
    },
  };
}

function generateTFWorkspace(index, opts) {
  const name = `tf-dummy-${index}`;

  const terraformValues = {
    instance_name: name,
    sleep_on_plan: opts.sleepOnPlan,
    crash_on_plan: opts.crashOnPlan,
    tries_before_plan_ok: opts.triesBeforePlanOk,
    sleep_on_apply: opts.sleepOnApply,
    crash_on_apply: opts.crashOnApply,
    tries_before_apply_ok: opts.triesBeforeApplyOk,
  };

  const cr = {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrTerraformWorkspace',
    metadata: {
      name: name,
      namespace: 'default',
      annotations: {
        'firestartr.dev/policy': opts.policy,
        'firestartr.dev/sync-policy': opts.syncPolicy,
      },
    },
    spec: {
      firestartr: {
        tfStateKey: uuid(),
      },
      source: 'Remote',
      module: 'git::https://github.com/prefapp/tfm.git//modules/dummy?ref=main',
      values: JSON.stringify(terraformValues),
      context: {
        backend: {
          ref: {
            kind: 'FirestartrProviderConfig',
            name: 'kubernetes-backend',
          },
        },
        providers: [],
      },
      references: [],
    },
  };

  return cr;
}

function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      lines.push(toYaml(value, indent + 1));
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of value) {
          if (typeof item === 'object') {
            lines.push(`${pad}-`);
            lines.push(toYaml(item, indent + 2));
          } else {
            lines.push(`${pad}- ${formatYamlValue(item)}`);
          }
        }
      }
    } else {
      lines.push(`${pad}${key}: ${formatYamlValue(value)}`);
    }
  }

  return lines.join('\n');
}

function formatYamlValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') return String(value);

  if (typeof value === 'string') {
    if (
      value.includes(': ') ||
      value.includes('#') ||
      value.startsWith('"') ||
      value.startsWith("'") ||
      value.startsWith('{') ||
      value.startsWith('[')
    ) {
      return `'${value.replace(/'/g, "''")}'`;
    }

    return value;
  }

  return String(value);
}

function main() {
  const opts = parseArgs();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dummies-ctl-'));

  // Write ProviderConfig
  const providerConfig = generateProviderConfig();
  const providerPath = path.join(tmpDir, 'kubernetes-backend.yaml');

  fs.writeFileSync(providerPath, `---\n${toYaml(providerConfig)}\n`);

  // Write TFWorkspace CRs
  for (let i = 0; i < opts.count; i++) {
    const cr = generateTFWorkspace(i, opts);
    const filePath = path.join(tmpDir, `tf-dummy-${i}.yaml`);

    fs.writeFileSync(filePath, `---\n${toYaml(cr)}\n`);
  }

  console.log(tmpDir);
}

main();
