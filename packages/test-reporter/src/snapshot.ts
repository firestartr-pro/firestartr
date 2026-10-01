import * as k8s from '@kubernetes/client-node';
import type {
  KubeConfigProvider,
  ExecFn,
  GhApiLike,
  SnapshotEntry,
  SnapshotCrEntry,
} from './types';
import { readOperatorInfoViaExec } from './operator-info';
import { gatherGithubInfo } from './github-info';

const FIRESTARTR_API_VERSION = 'firestartr.dev/v1';

const CRD_KINDS = [
  'FirestartrGithubRepository',
  'FirestartrGithubGroup',
  'FirestartrGithubMembership',
  'FirestartrGithubRepositoryFeature',
  'FirestartrGithubRepositorySecretsSection',
  'FirestartrTerraformWorkspace',
  'FirestartrTerraformWorkspacePlan',
  'FirestartrGithubOrgWebhook',
  'FirestartrGithubOrganizationSettings',
  'FirestartrGithubOrganizationVariableSection',
  'FirestartrProviderConfig',
];

interface K8sResourceLike {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  status?: unknown;
  spec?: unknown;
}

function isK8sResourceLike(obj: unknown): obj is K8sResourceLike {
  return obj !== null && typeof obj === 'object' && 'metadata' in obj;
}

function kindToPlural(kind: string): string {
  const bare = kind.startsWith('Firestartr')
    ? kind.slice('Firestartr'.length)
    : kind;
  const lower = bare.toLowerCase();
  return lower.endsWith('y') && !/[aeiou]$/.test(lower.slice(0, -1))
    ? `${lower.slice(0, -1)}ies`
    : `${lower}s`;
}

async function listCustomResources(
  api: k8s.CustomObjectsApi,
  namespace: string,
  kind: string,
): Promise<Array<{ name: string; status: unknown }>> {
  const plural = kindToPlural(kind);
  try {
    const response = await api.listNamespacedCustomObject(
      'firestartr.dev',
      FIRESTARTR_API_VERSION.split('/')[1] ?? 'v1',
      namespace,
      plural,
    );
    const body = response.body as { items?: unknown[] };
    const items = Array.isArray(body?.items) ? body.items : [];
    return items.filter(isK8sResourceLike).map((item) => ({
      name: item.metadata?.name ?? '<unknown>',
      status: item.status,
    }));
  } catch {
    return [];
  }
}

interface TfResultReference {
  refKind: string;
  refName: string;
}

interface TfResultWithRef {
  name: string;
  spec: { reference: TfResultReference; result?: unknown };
  status: unknown;
}

async function listTfResults(
  api: k8s.CustomObjectsApi,
  namespace: string,
): Promise<TfResultWithRef[]> {
  try {
    const response = await api.listNamespacedCustomObject(
      'firestartr.dev',
      'v1',
      namespace,
      'tfresults',
    );
    const body = response.body as { items?: unknown[] };
    const items = Array.isArray(body?.items) ? body.items : [];
    return items.filter(isK8sResourceLike).map((item) => ({
      name: item.metadata?.name ?? '<unknown>',
      spec: item.spec as TfResultWithRef['spec'],
      status: item.status,
    }));
  } catch {
    return [];
  }
}

type GithubSnapshot = {
  repos: string[];
  groups: string[];
  users: string[];
  webhooks: string[];
};

export async function gatherSnapshot(params: {
  kubeConfigProvider: KubeConfigProvider;
  execFn?: ExecFn;
  ghApi?: GhApiLike;
  namespace: string;
  operatorPodName?: string;
  includeGithub?: boolean;
}): Promise<SnapshotEntry> {
  const {
    kubeConfigProvider,
    execFn,
    ghApi,
    namespace,
    operatorPodName,
    includeGithub,
  } = params;

  const kc = kubeConfigProvider();
  const api = kc.makeApiClient(k8s.CustomObjectsApi);

  const crsByKind: Record<string, SnapshotCrEntry[]> = {};
  for (const kind of CRD_KINDS) {
    const items = await listCustomResources(api, namespace, kind);
    if (items.length > 0) {
      crsByKind[kind] = items.map((item) => ({
        ...item,
        tfResults: [],
      }));
    }
  }

  const tfResults = await listTfResults(api, namespace);

  for (const tfResult of tfResults) {
    const { refKind, refName } = tfResult.spec?.reference ?? {};
    if (refKind && refName && crsByKind[refKind]) {
      const cr = crsByKind[refKind].find((c) => c.name === refName);
      if (cr) {
        cr.tfResults.push({
          name: tfResult.name,
          spec: tfResult.spec,
          status: tfResult.status,
        });
      }
    }
  }

  let operator = { queue: '', diagnostics: '' };
  if (execFn && operatorPodName) {
    operator = await readOperatorInfoViaExec(
      execFn,
      operatorPodName,
      namespace,
    );
  }

  let github: GithubSnapshot | undefined;
  if (includeGithub) {
    if (!ghApi) {
      throw new Error(
        'snapshot({ includeGithub: true }) requires a ghApi provider. ' +
          'Pass ghApi in TestReporterOptions.',
      );
    }
    github = await gatherGithubInfo(ghApi);
  }

  return {
    timestamp: new Date().toISOString(),
    namespace,
    crsByKind,
    operator,
    ...(github !== undefined ? { github } : undefined),
  };
}
