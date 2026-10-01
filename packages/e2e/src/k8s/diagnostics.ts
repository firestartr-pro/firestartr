import * as k8s from '@kubernetes/client-node';
import { getPrimaryManifestResource } from './manifests';
import { readResource } from './wait';
import { findTFResultsByReference } from './tfresult';

import type { K8sResource, KubeConfigProvider } from './types';
import type { TFResult } from './tfresult';

export const E2E_DIAGNOSTIC_BEGIN = 'E2E_DIAGNOSTIC_BEGIN';
export const E2E_DIAGNOSTIC_END = 'E2E_DIAGNOSTIC_END';

const MAX_OPERATOR_LOG_LINES = 500;
const MAX_EVENTS = 15;

function resolveOperatorNamespace(): string {
  return process.env['E2E_OPERATOR_NAMESPACE'] ?? 'default';
}

function resolveOperatorPodLabel(): string {
  return (
    process.env['E2E_OPERATOR_POD_LABEL'] ??
    'app=firestartr-controller,concern=controller'
  );
}

function writeDiagnosticBlock(lines: string[]): void {
  process.stderr.write(`${lines.join('\n')}\n`);
}

type PodLogClient = {
  readNamespacedPodLog(params: {
    name: string;
    namespace: string;
    container?: string;
    follow?: boolean;
    insecureSkipTLSVerifyBackend?: boolean;
    limitBytes?: number;
    pretty?: string;
    previous?: boolean;
    sinceSeconds?: number;
    stream?: string;
    tailLines?: number;
    timestamps?: boolean;
  }): Promise<unknown>;
};

function formatPodLogHeader(
  podName: string,
  containerName: string | undefined,
  previous: boolean,
): string {
  const container = containerName ?? '<default>';
  const suffix = previous ? ' previous' : '';

  return `- pod=${podName} container=${container}${suffix}:`;
}

function extractPodLogBody(logResponse: unknown): string {
  if (typeof logResponse === 'string') {
    return logResponse;
  }

  if (logResponse !== null && typeof logResponse === 'object') {
    const response = logResponse as { body?: unknown };
    if (typeof response.body === 'string') {
      return response.body;
    }
  }

  return '';
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }

  if (err !== null && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const statusCode =
      typeof obj['statusCode'] === 'number' ? obj['statusCode'] : undefined;
    const message =
      typeof obj['message'] === 'string' ? obj['message'] : undefined;
    const body = obj['body'];
    const bodyText =
      body !== undefined && body !== null
        ? ` body=${JSON.stringify(body).slice(0, 300)}`
        : '';
    const statusText = statusCode !== undefined ? ` status=${statusCode}` : '';
    if (message) return `${message}${statusText}${bodyText}`;
    if (statusCode !== undefined) return `[object]${statusText}${bodyText}`;
    // Safe fallback: avoid '[object Object]'
    try {
      return JSON.stringify(obj);
    } catch {
      return '[unserializable error]';
    }
  }

  return String(err);
}

function isErrorLikeText(value: string | undefined): boolean {
  return Boolean(value?.match(/DLH|error|failed|failure|not found/i));
}

function formatErrorConditions(resource: K8sResource): string[] {
  const conditions = resource.status?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return ['- none'];
  }

  const errorConditions = conditions.filter(
    (condition) =>
      condition.type === 'ERROR' ||
      isErrorLikeText(condition.reason) ||
      isErrorLikeText(condition.message),
  );

  if (errorConditions.length === 0) {
    return ['- none'];
  }

  return errorConditions.map((condition) => {
    const details = [
      `type=${condition.type}`,
      `status=${String(condition.status)}`,
      condition.reason ? `reason=${condition.reason}` : undefined,
      condition.message ? `message=${condition.message}` : undefined,
      condition.lastUpdateTime
        ? `lastUpdateTime=${condition.lastUpdateTime}`
        : undefined,
      condition.lastTransitionTime
        ? `lastTransitionTime=${condition.lastTransitionTime}`
        : undefined,
    ].filter((value): value is string => Boolean(value));

    return `- ${details.join(' ')}`;
  });
}

const MAX_TFRESULT_LINES = 80;

function formatTFResult(tfResult: TFResult): string[] {
  const name = tfResult.metadata?.name ?? '<unknown>';
  const action = tfResult.spec?.action ?? '<unknown>';
  const rawResult = tfResult.spec?.result ?? '<empty>';
  const exitCode = tfResult.status?.exitCode;
  const exitCodeLine =
    typeof exitCode === 'number' ? `  exitCode: ${exitCode}` : undefined;

  const resultLines = rawResult.split('\n');
  const truncated = resultLines.length > MAX_TFRESULT_LINES;
  const visibleLines = truncated
    ? resultLines.slice(-MAX_TFRESULT_LINES)
    : resultLines;
  const truncationNotice = truncated
    ? [
        `    ... (${resultLines.length - MAX_TFRESULT_LINES} lines omitted, showing last ${MAX_TFRESULT_LINES})`,
      ]
    : [];

  return [
    `- ${tfResult.kind}/${name}`,
    `  action: ${action}`,
    ...(exitCodeLine ? [exitCodeLine] : []),
    '  result:',
    ...truncationNotice,
    ...visibleLines.map((line) => `    ${line}`),
  ];
}

function formatTFResults(tfResults: TFResult[]): string[] {
  if (tfResults.length === 0) {
    return ['- none found'];
  }

  return tfResults.flatMap((tfResult, i) => [
    ...(i > 0 ? [''] : []),
    ...formatTFResult(tfResult),
  ]);
}

function formatResourceIdentity(
  resource: K8sResource,
  fallbackNamespace: string,
): string {
  const namespace = resource.metadata?.namespace ?? fallbackNamespace;
  const name = resource.metadata?.name ?? '<unknown>';

  return `${namespace}/${resource.kind}/${name}`;
}

async function collectKubernetesEvents(
  kubeConfigProvider: KubeConfigProvider,
  namespace: string,
  resourceName: string,
): Promise<string[]> {
  try {
    const coreApi = kubeConfigProvider().makeApiClient(k8s.CoreV1Api);
    const fieldSelector = `involvedObject.name=${resourceName},involvedObject.namespace=${namespace}`;
    const response = await coreApi.listNamespacedEvent({
      namespace,
      fieldSelector,
    });

    const events = response.items ?? [];
    if (events.length === 0) {
      return ['- none'];
    }

    return events.slice(-MAX_EVENTS).map((ev) => {
      const type = ev.type ?? '?';
      const reason = ev.reason ?? '?';
      const message = ev.message ?? '';
      const count = ev.count ? ` (x${ev.count})` : '';
      const time =
        ev.lastTimestamp?.toISOString() ?? ev.eventTime?.toISOString() ?? '';
      return `- [${type}] ${reason}${count} ${time}: ${message}`;
    });
  } catch (err) {
    return [`- collection failed: ${formatUnknownError(err)}`];
  }
}

async function collectOperatorLogs(
  kubeConfigProvider: KubeConfigProvider,
): Promise<string[]> {
  const operatorNamespace = resolveOperatorNamespace();
  const podLabel = resolveOperatorPodLabel();

  try {
    const coreApi = kubeConfigProvider().makeApiClient(k8s.CoreV1Api);

    const podsResponse = await coreApi.listNamespacedPod({
      namespace: operatorNamespace,
      labelSelector: podLabel,
    });

    const pods = podsResponse.items ?? [];
    if (pods.length === 0) {
      return [
        `- no operator pods found (namespace=${operatorNamespace} label=${podLabel})`,
      ];
    }

    const pod = pods[0];
    const podName = pod.metadata?.name ?? '<unknown>';
    const containerNames =
      pod.spec?.containers
        ?.map((container) => container.name)
        .filter(Boolean) ?? [];
    const logContainers =
      containerNames.length > 0 ? containerNames : [undefined];

    const collectForContainer = async (
      containerName: string | undefined,
      previous: boolean,
    ): Promise<string[]> => {
      try {
        const podLogApi = coreApi as unknown as PodLogClient;
        const logResponse = await podLogApi.readNamespacedPodLog({
          name: podName,
          namespace: operatorNamespace,
          container: containerName,
          follow: false,
          previous,
          tailLines: MAX_OPERATOR_LOG_LINES,
        });
        const rawLog = extractPodLogBody(logResponse);

        if (!rawLog) {
          return [
            `${formatPodLogHeader(podName, containerName, previous)} <empty>`,
          ];
        }

        const allLines = rawLog.split('\n').filter(Boolean);
        const header = formatPodLogHeader(podName, containerName, previous);

        if (allLines.length === 0) {
          return [`${header} <empty>`];
        }

        return [header, ...allLines.map((line) => line)];
      } catch (err) {
        return [
          `${formatPodLogHeader(podName, containerName, previous)} collection failed: ${formatUnknownError(err)}`,
        ];
      }
    };

    const operatorLogSections = await Promise.all(
      logContainers.flatMap((containerName) => [
        collectForContainer(containerName, false),
        collectForContainer(containerName, true),
      ]),
    );

    return operatorLogSections.flat();
  } catch (err) {
    return [`- collection failed: ${formatUnknownError(err)}`];
  }
}

export async function logCrDiagnostics(
  kubeConfigProvider: KubeConfigProvider,
  namespace: string,
  crPath: string,
  cause: unknown,
): Promise<void> {
  let resource: K8sResource;

  try {
    resource = await getPrimaryManifestResource(crPath);
  } catch (err) {
    writeDiagnosticBlock([
      `[${E2E_DIAGNOSTIC_BEGIN}] ${crPath}`,
      `Failed to read rendered resource: ${formatUnknownError(err)}`,
      `Original failure: ${formatUnknownError(cause)}`,
      `[${E2E_DIAGNOSTIC_END}]`,
    ]);
    return;
  }

  const identity = formatResourceIdentity(resource, namespace);
  const resourceName = resource.metadata?.name;
  let liveResource: K8sResource | undefined;
  let liveResourceLookupError: unknown;
  let tfResults: TFResult[] = [];
  let tfResultLookupError: unknown;

  try {
    liveResource = await readResource(kubeConfigProvider, namespace, resource);
  } catch (err) {
    liveResourceLookupError = err;
  }

  if (resourceName) {
    try {
      tfResults = await findTFResultsByReference(
        kubeConfigProvider,
        namespace,
        resource.kind,
        resourceName,
      );
    } catch (err) {
      tfResultLookupError = err;
    }
  }

  const [events, operatorLogs] = await Promise.all([
    resourceName
      ? collectKubernetesEvents(kubeConfigProvider, namespace, resourceName)
      : Promise.resolve(['- resource name unknown']),
    resourceName
      ? collectOperatorLogs(kubeConfigProvider)
      : Promise.resolve(['- resource name unknown']),
  ]);

  const diagnosticLines = [
    `[${E2E_DIAGNOSTIC_BEGIN}] ${identity}`,
    `Manifest path: ${crPath}`,
    `Failure: ${formatUnknownError(cause)}`,
    '',
    'Relevant resource conditions:',
  ];

  if (liveResourceLookupError) {
    diagnosticLines.push(
      `- lookup failed: ${formatUnknownError(liveResourceLookupError)}`,
    );
  } else if (liveResource) {
    diagnosticLines.push(...formatErrorConditions(liveResource));
  } else {
    diagnosticLines.push('- none found');
  }

  diagnosticLines.push('', 'TFResult details:');
  if (tfResultLookupError) {
    diagnosticLines.push(
      `- lookup failed: ${formatUnknownError(tfResultLookupError)}`,
    );
  } else {
    diagnosticLines.push(...formatTFResults(tfResults));
  }

  diagnosticLines.push('', 'Kubernetes events:', ...events);
  diagnosticLines.push('', 'Operator log snippets:', ...operatorLogs);
  diagnosticLines.push(`[${E2E_DIAGNOSTIC_END}]`);

  writeDiagnosticBlock(diagnosticLines);
}
