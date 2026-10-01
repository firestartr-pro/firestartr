#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const TYPES = {
  A: { kind: 'FirestartrDummyA', shortName: 'fsda', needsKind: null, needsField: false },
  B: { kind: 'FirestartrDummyB', shortName: 'fsdb', needsKind: 'FirestartrDummyA', needsField: true },
  C: { kind: 'FirestartrDummyC', shortName: 'fsdc', needsKind: 'FirestartrDummyB', needsField: true },
};

function usage(exitCode = 0) {
  console.error(`Usage: dummies-ctl.cjs --type <A|B|C> --count <n> [--root-name <name>]

Generate dummy Custom Resource YAML files for operator testing.

Options:
  --type, -t       A, B, or C (required)
  --count, -n      Number of CRs to generate (required)
  --root-name, -r       For B: name of the A root this B depends on
                        For C: name of the B root this C depends on
  --number-of-seconds-to-sleep, -s   spec.computation.numberOfSeconds (default: 5)
  --number-of-seconds-to-destroy, -d spec.computation.numberOfSecondsToDestroy (default: 10)
  --help, -h            Show this help

Examples:
  dummies-ctl.cjs -t A -n 3
  dummies-ctl.cjs -t B -n 2 --root-name fsda-0
  dummies-ctl.cjs -t A -n 1 -s 30 -d 60`);
  process.exit(exitCode);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
  }

  let type = null;
  let count = null;
  let rootName = null;
  let secondsToSleep = 5;
  let secondsToDestroy = 10;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--type' || arg === '-t') {
      type = args[++i]?.toUpperCase();
    } else if (arg === '--count' || arg === '-n') {
      count = parseInt(args[++i], 10);
    } else if (arg === '--root-name' || arg === '-r') {
      rootName = args[++i];
    } else if (arg === '--number-of-seconds-to-sleep' || arg === '-s') {
      secondsToSleep = parseInt(args[++i], 10);
      if (isNaN(secondsToSleep) || secondsToSleep < 0) {
        console.error('Error: --number-of-seconds-to-sleep must be a non-negative integer');
        process.exit(1);
      }
    } else if (arg === '--number-of-seconds-to-destroy' || arg === '-d') {
      secondsToDestroy = parseInt(args[++i], 10);
      if (isNaN(secondsToDestroy) || secondsToDestroy < 0) {
        console.error('Error: --number-of-seconds-to-destroy must be a non-negative integer');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      usage();
    } else {
      console.error(`Unknown option: ${arg}`);
      usage(1);
    }
  }

  if (!type || !TYPES[type]) {
    console.error('Error: --type must be A, B, or C');
    process.exit(1);
  }

  if (!count || isNaN(count) || count < 1) {
    console.error('Error: --count must be a positive integer');
    process.exit(1);
  }

  const typeDef = TYPES[type];
  if (typeDef.needsField && !rootName) {
    console.error(`Error: --root-name is required for type ${type}`);
    process.exit(1);
  }

  if (!typeDef.needsField && rootName) {
    console.error(`Warning: --root-name is ignored for type ${type} (no dependency field)`);
  }

  return { type, typeDef, count, rootName, secondsToSleep, secondsToDestroy };
}

function generateDummy(index, typeDef, rootName, secondsToSleep, secondsToDestroy) {
  const name = `${typeDef.shortName}-${index}`;

  const cr = {
    apiVersion: 'firestartr.dev/v1',
    kind: typeDef.kind,
    metadata: {
      name: name,
      namespace: 'default',
    },
    spec: {
      computation: {
        numberOfSeconds: secondsToSleep,
        numberOfSecondsToDestroy: secondsToDestroy,
      },
    },
  };

  if (typeDef.needsField && rootName) {
    cr.spec.needs = {
      name: rootName,
      kind: typeDef.needsKind,
    };
  }

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
      lines.push(`${pad}${key}:`);
      for (const item of value) {
        if (typeof item === 'object') {
          lines.push(`${pad}-`);
          lines.push(toYaml(item, indent + 2));
        } else {
          lines.push(`${pad}- ${formatYamlValue(item)}`);
        }
      }
    } else {
      lines.push(`${pad}${key}: ${formatYamlValue(value)}`);
    }
  }

  return lines.join('\n');
}

function formatYamlValue(value) {
  if (typeof value === 'string') {
    if (value.includes(': ') || value.includes('#') || value.startsWith('"') || value.startsWith("'")) {
      return JSON.stringify(value);
    }
    return value;
  }
  return String(value);
}

function main() {
  const { type, typeDef, count, rootName, secondsToSleep, secondsToDestroy } = parseArgs();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dummies-ctl-'));
  const files = [];

  for (let i = 0; i < count; i++) {
    const cr = generateDummy(i, typeDef, rootName, secondsToSleep, secondsToDestroy);
    const filePath = path.join(tmpDir, `${cr.metadata.name}.yaml`);
    const yaml = toYaml(cr);
    // Add document separator
    fs.writeFileSync(filePath, `---\n${yaml}\n`);
    files.push(filePath);
  }

  console.log(tmpDir);
}

main();
