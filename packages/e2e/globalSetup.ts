import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

const DIAGNOSTIC_HOST_FILE = '/tmp/diagnosis';
const POLL_INTERVAL_MS = 15 * 1000;
const OPERATOR_DIAGNOSTIC_PATH = '/tmp/diagnostic';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function resolveOperatorNamespace(): string {
  return process.env['E2E_OPERATOR_NAMESPACE'] ?? 'default';
}

function resolveOperatorPodLabel(): string {
  return (
    process.env['E2E_OPERATOR_POD_LABEL'] ??
    'app=firestartr-controller,concern=controller'
  );
}

function buildKubectlPrefix(): string {
  const parts = ['kubectl'];
  const kubeconfig = process.env['E2E_KUBECONFIG'] ?? process.env['KUBECONFIG'];
  if (kubeconfig) {
    parts.push(`--kubeconfig="${kubeconfig}"`);
  }
  const context = process.env['E2E_KUBECONFIG_CONTEXT'];
  if (context) {
    parts.push(`--context="${context}"`);
  }
  return parts.join(' ');
}

function findOperatorPod(
  kubectlPrefix: string,
  namespace: string,
  label: string,
): string | null {
  try {
    const cmd = `${kubectlPrefix} get pods -n ${namespace} -l "${label}" --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 10_000 })
      .trim()
      .replace(/^'|'$/g, '');
    return result || null;
  } catch {
    return null;
  }
}

function readDiagnosticFromPod(
  kubectlPrefix: string,
  namespace: string,
  podName: string,
): string | null {
  try {
    const cmd = `${kubectlPrefix} exec -n ${namespace} ${podName} -- cat ${OPERATOR_DIAGNOSTIC_PATH} 2>/dev/null`;
    return execSync(cmd, { encoding: 'utf-8', timeout: 10_000 });
  } catch {
    return null;
  }
}

function collectSnapshot(): void {
  const kubectlPrefix = buildKubectlPrefix();
  const namespace = resolveOperatorNamespace();
  const label = resolveOperatorPodLabel();

  const podName = findOperatorPod(kubectlPrefix, namespace, label);
  if (!podName) {
    console.log(
      `[diagnostic] no operator pod found (ns=${namespace} label=${label})`,
    );
    return;
  }

  const snapshot = readDiagnosticFromPod(kubectlPrefix, namespace, podName);
  if (!snapshot) {
    console.log(`[diagnostic] no snapshot from pod ${podName}`);
    return;
  }

  const separator = `---\n# collected at ${new Date().toISOString()} from pod ${podName}\n`;
  fs.appendFileSync(DIAGNOSTIC_HOST_FILE, separator + snapshot + '\n');
  console.log(
    `[diagnostic] collected snapshot from ${podName} (${snapshot.length} bytes)`,
  );
}

export default async function globalSetup(): Promise<void> {
  if (process.env['DISABLE_DIAGNOSTIC_COLLECTOR']) {
    return;
  }

  // Clear any previous diagnostic file
  fs.writeFileSync(
    DIAGNOSTIC_HOST_FILE,
    `# e2e diagnostic collector started at ${new Date().toISOString()}\n`,
  );

  // Start the collection loop
  intervalHandle = setInterval(() => {
    try {
      collectSnapshot();
    } catch {
      // Never let the collector crash the test suite
    }
  }, POLL_INTERVAL_MS);

  // Store the handle so globalTeardown can stop it
  (globalThis as Record<string, unknown>).__diagnosticInterval = intervalHandle;
}
