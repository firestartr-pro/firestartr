import fs from 'node:fs';

function getOutputFile() {
  return process.env.OUTPUT_FILE || process.env.GITHUB_OUTPUT || '/dev/stdout';
}

function writeOutput(name, value) {
  const outputFile = getOutputFile();
  const line = `${name}=${value}\n`;

  if (outputFile === '/dev/stdout') {
    process.stdout.write(line);
    return;
  }

  fs.appendFileSync(outputFile, line, 'utf8');
}

function splitCommaSeparatedList(rawValue) {
  if (!rawValue) {
    return [];
  }

  const parts = rawValue.split(',');
  const values = [];

  for (const part of parts) {
    const trimmedValue = part.trim();

    if (trimmedValue === '') {
      throw new Error('Suite list contains an empty value');
    }

    values.push(trimmedValue);
  }

  return values;
}

function removeDuplicates(values) {
  const uniqueValues = [];

  for (const value of values) {
    if (!uniqueValues.includes(value)) {
      uniqueValues.push(value);
    }
  }

  return uniqueValues;
}

function parseAllSuites() {
  const allSuites = splitCommaSeparatedList(process.env.ALL_SUITES || '');

  if (allSuites.length === 0) {
    throw new Error('ALL_SUITES must define at least one suite');
  }

  return removeDuplicates(allSuites);
}

function parsePushSuites(allSuites) {
  const rawPushSuites = process.env.PUSH_SUITES || '';

  if (rawPushSuites === '') {
    return allSuites;
  }

  return removeDuplicates(splitCommaSeparatedList(rawPushSuites));
}

function shouldRunAllSuites() {
  return process.env.ALL_SUITES_FLAG === 'true';
}

const SUITE_CHECKBOXES = {
  'github': 'SUITE_GITHUB',
  'terraform': 'SUITE_TERRAFORM',
  'massive': 'SUITE_MASSIVE',
  'k8s-rate-limits': 'SUITE_K8S_RATE_LIMITS',
  'crd-upgrade': 'SUITE_CRD_UPGRADE',
  'retry-lifecycle': 'SUITE_RETRY_LIFECYCLE',
  'core': 'SUITE_CORE',
};

function collectCheckboxSuites() {
  const suites = [];

  for (const [suite, envVar] of Object.entries(SUITE_CHECKBOXES)) {
    if (process.env[envVar] === 'true') {
      suites.push(suite);
    }
  }

  return suites;
}

function selectSuites(allSuites, pushSuites) {
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    return pushSuites;
  }

  if (shouldRunAllSuites()) {
    return allSuites;
  }

  const suitesInput = (process.env.SUITES || '').trim();

  if (suitesInput) {
    return removeDuplicates(splitCommaSeparatedList(suitesInput));
  }

  const checkboxSuites = collectCheckboxSuites();

  if (checkboxSuites.length > 0) {
    return checkboxSuites;
  }

  return pushSuites;
}

function main() {
  const allSuites = parseAllSuites();
  const pushSuites = parsePushSuites(allSuites);
  const selectedSuites = selectSuites(allSuites, pushSuites);

  writeOutput('suites', JSON.stringify(selectedSuites));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
