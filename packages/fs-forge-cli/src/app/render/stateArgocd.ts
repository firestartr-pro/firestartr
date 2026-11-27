import YAML, { YAMLMap, YAMLSeq } from 'yaml';

import { loadVendorValidator } from '../../schema/vendorSchemas.js';
import { formatAjvErrors } from '../../utils/ajvValidation.js';
import { isRecord } from '../../utils/isRecord.js';

import type { RenderedFile } from './types.js';
import type { AppInputs } from '../../schema/appInputs.js';
import type { DiscoveredPlatform } from '../dotFirestartr.js';

export interface RenderStateArgocdOptions {
  org: string;
  inputs: AppInputs;
  platforms: DiscoveredPlatform[];
  vendorDir: string;
  existingApplicationSet?: { path: string; content: string };
  existingAppProject?: { path: string; content: string };
}

export interface RenderedArgocdFiles {
  applicationSet: RenderedFile;
  appProject: RenderedFile;
}

const CLUSTER_RESOURCE_WHITELIST = [
  { group: '', kind: 'Namespace' },
  { group: '', kind: 'PersistentVolume' },
  { group: 'networking.k8s.io', kind: 'IngressClass' },
  { group: 'rbac.authorization.k8s.io', kind: 'ClusterRole' },
  { group: 'rbac.authorization.k8s.io', kind: 'ClusterRoleBinding' },
  { group: 'apiextensions.k8s.io', kind: 'CustomResourceDefinition' },
];

const IGNORE_DIFFERENCES_JSON_POINTERS = [
  '/status',
  '/metadata/uid',
  '/metadata/generation',
  '/metadata/resourceVersion',
  '/metadata/creationTimestamp',
];

const IGNORE_DIFFERENCES = [
  {
    group: 'policy',
    kind: 'PodDisruptionBudget',
    jsonPointers: IGNORE_DIFFERENCES_JSON_POINTERS,
  },
  {
    group: 'keda.sh',
    kind: 'ScaledObject',
    jsonPointers: IGNORE_DIFFERENCES_JSON_POINTERS,
  },
];

function validateVendorDocErrors(
  name: 'argocd-applicationset' | 'argocd-appproject',
  data: unknown,
  vendorDir: string,
): string[] | undefined {
  const validate = loadVendorValidator(name, vendorDir);
  if (!validate(data)) {
    return formatAjvErrors(validate.errors);
  }
  return undefined;
}

function validateVendorDoc(
  name: 'argocd-applicationset' | 'argocd-appproject',
  data: unknown,
  vendorDir: string,
): void {
  const errors = validateVendorDocErrors(name, data, vendorDir);
  if (errors) {
    throw new Error(
      `Rendered ${name} failed schema validation: ${errors.join('; ')}`,
    );
  }
}

function preserveEol(rendered: string, existingContent: string): string {
  if (existingContent.includes('\r\n') && !/(?<!\r)\n/.test(existingContent)) {
    return rendered.replace(/\r?\n/g, '\r\n');
  }
  return rendered;
}

function extractExistingClusterValues(existingApplicationSet?: {
  path: string;
  content: string;
}): Record<string, string> | undefined {
  if (!existingApplicationSet) return undefined;
  const doc = YAML.parseDocument(existingApplicationSet.content);
  if (doc.errors.length > 0) return undefined;
  const parsed: unknown = doc.toJS();
  if (!isRecord(parsed)) return undefined;
  const spec = isRecord(parsed.spec) ? parsed.spec : undefined;
  const generators =
    spec && Array.isArray(spec.generators) ? spec.generators : [];
  const firstGen = isRecord(generators[0]) ? generators[0] : undefined;
  const gitGen = firstGen && isRecord(firstGen.git) ? firstGen.git : undefined;
  const values = gitGen && isRecord(gitGen.values) ? gitGen.values : undefined;
  if (!values) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string') {
      result[k] = v;
    }
  }
  return result;
}

function collectClusterValues(
  inputs: AppInputs,
): { values: Record<string, string> } | { conflict: string } {
  const values: Record<string, string> = {};
  for (const target of inputs.targets) {
    const existing = values[target.platform];
    if (existing !== undefined && existing !== target.cluster_url) {
      return {
        conflict: `Conflicting cluster URLs for "${target.platform}": "${existing}" vs "${target.cluster_url}"`,
      };
    }
    values[target.platform] = target.cluster_url;
  }
  return { values };
}

function resolvePlatformType(
  inputs: AppInputs,
  platforms: DiscoveredPlatform[],
): string {
  const firstTarget = inputs.targets[0];
  if (!firstTarget) return 'kubernetes';
  const match = platforms.find((p) => p.name === firstTarget.platform);
  return match && match.type ? match.type : 'kubernetes';
}

function renderApplicationSet(options: RenderStateArgocdOptions): RenderedFile {
  const { org, inputs, platforms, vendorDir, existingApplicationSet } = options;
  const app = inputs.app;
  const expectedName = `app-${app}`;
  const expectedRepoUrl = `https://github.com/${org}/app-${app}.git`;
  const path =
    existingApplicationSet?.path ??
    `apps/${app}/argo-${app}.ApplicationSet.yaml`;

  const clusterValuesResult = collectClusterValues(inputs);
  if ('conflict' in clusterValuesResult) {
    return {
      path,
      outcome: { kind: 'conflict', reason: clusterValuesResult.conflict },
    };
  }
  const desiredValues = clusterValuesResult.values;

  if (!existingApplicationSet) {
    const platformType = resolvePlatformType(inputs, platforms);
    const obj = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'ApplicationSet',
      metadata: {
        name: expectedName,
        namespace: 'argocd',
      },
      spec: {
        goTemplate: true,
        goTemplateOptions: ['missingkey=error'],
        generators: [
          {
            git: {
              repoURL: expectedRepoUrl,
              revision: 'deployment',
              directories: [{ path: `${platformType}/*/*/*` }],
              values: desiredValues,
            },
          },
        ],
        template: {
          metadata: {
            name: `app-${app}-{{index .path.segments 1}}-{{index .path.segments 2}}-{{index .path.segments 3}}`,
            labels: {
              'app-name': app,
            },
          },
          spec: {
            project: expectedName,
            source: {
              repoURL: expectedRepoUrl,
              targetRevision: 'deployment',
              path: '{{index .path.segments 0}}/{{index .path.segments 1}}/{{index .path.segments 2}}/{{index .path.segments 3}}',
            },
            destination: {
              server: '{{index .values (index .path.segments 1)}}',
              namespace: `{{index .path.segments 2}}-${app}-{{index .path.segments 3}}`,
            },
            syncPolicy: {
              automated: {
                prune: true,
              },
              syncOptions: ['CreateNamespace=true', 'ServerSideApply=true'],
            },
            ignoreDifferences: IGNORE_DIFFERENCES,
          },
        },
      },
    };
    validateVendorDoc('argocd-applicationset', obj, vendorDir);
    return {
      path,
      content: YAML.stringify(obj),
      outcome: { kind: 'create' },
    };
  }

  const existingContent = existingApplicationSet.content;
  const doc = YAML.parseDocument(existingContent);
  if (doc.errors.length > 0) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Malformed YAML in ${path}: ${doc.errors[0].message}`,
      },
    };
  }

  const parsed: unknown = doc.toJS();
  if (!isRecord(parsed)) {
    return {
      path,
      outcome: { kind: 'conflict', reason: `Expected YAML mapping in ${path}` },
    };
  }

  if (parsed.kind !== 'ApplicationSet') {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected kind "ApplicationSet", found "${String(parsed.kind ?? '')}"`,
      },
    };
  }

  const metadata = isRecord(parsed.metadata) ? parsed.metadata : undefined;
  if (metadata?.name !== expectedName) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected metadata.name "${expectedName}", found "${String(metadata?.name ?? '')}"`,
      },
    };
  }

  const spec = isRecord(parsed.spec) ? parsed.spec : undefined;
  const generators =
    spec && Array.isArray(spec.generators) ? spec.generators : [];
  const firstGen = isRecord(generators[0]) ? generators[0] : undefined;
  const gitGen = firstGen && isRecord(firstGen.git) ? firstGen.git : undefined;
  if (!gitGen || gitGen.repoURL !== expectedRepoUrl) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected git generator repoURL "${expectedRepoUrl}", found "${String(gitGen?.repoURL ?? '')}"`,
      },
    };
  }

  const template = spec && isRecord(spec.template) ? spec.template : undefined;
  const templateMeta =
    template && isRecord(template.metadata) ? template.metadata : undefined;
  const templateLabels =
    templateMeta && isRecord(templateMeta.labels)
      ? templateMeta.labels
      : undefined;
  if (templateLabels?.['app-name'] !== app) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected template label app-name="${app}", found "${String(templateLabels?.['app-name'] ?? '')}"`,
      },
    };
  }

  const templateSpec =
    template && isRecord(template.spec) ? template.spec : undefined;
  if (templateSpec?.project !== expectedName) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected template spec.project "${expectedName}", found "${String(templateSpec?.project ?? '')}"`,
      },
    };
  }

  const templateSource = isRecord(templateSpec?.source)
    ? templateSpec.source
    : undefined;
  if (templateSource?.repoURL !== expectedRepoUrl) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected template source.repoURL "${expectedRepoUrl}", found "${String(templateSource?.repoURL ?? '')}"`,
      },
    };
  }

  const gitNode = doc.getIn(['spec', 'generators', 0, 'git'], true);
  if (!(gitNode instanceof YAMLMap)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Missing spec.generators[0].git mapping in ${path}`,
      },
    };
  }

  const rawValues: unknown = gitNode.get('values', true);
  if (gitNode.has('values') && !(rawValues instanceof YAMLMap)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected "values" to be a YAML mapping in ${path}`,
      },
    };
  }
  let valuesMap: YAMLMap;
  if (rawValues instanceof YAMLMap) {
    valuesMap = rawValues;
  } else {
    valuesMap = doc.createNode({});
    gitNode.set('values', valuesMap);
  }

  const added: string[] = [];
  for (const [cluster, url] of Object.entries(desiredValues)) {
    if (valuesMap.has(cluster)) {
      const existingUrl = valuesMap.get(cluster);
      if (existingUrl !== url) {
        return {
          path,
          outcome: {
            kind: 'conflict',
            reason: `Cluster "${cluster}" has URL "${String(existingUrl)}", expected "${url}"`,
          },
        };
      }
    } else {
      valuesMap.set(cluster, url);
      added.push(`value:${cluster}`);
    }
  }

  if (added.length === 0) {
    return {
      path,
      content: existingContent,
      outcome: { kind: 'noop' },
    };
  }

  const validationErrors = validateVendorDocErrors(
    'argocd-applicationset',
    doc.toJS(),
    vendorDir,
  );
  if (validationErrors) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Merged ${path} failed schema validation: ${validationErrors.join('; ')}`,
      },
    };
  }
  return {
    path,
    content: preserveEol(doc.toString(), existingContent),
    outcome: { kind: 'merge', added },
  };
}

function renderAppProject(
  options: RenderStateArgocdOptions,
  existingClusterValues?: Record<string, string>,
): RenderedFile {
  const { org, inputs, vendorDir, existingAppProject } = options;
  const app = inputs.app;
  const expectedName = `app-${app}`;
  const expectedRepoUrl = `https://github.com/${org}/app-${app}.git`;
  const path =
    existingAppProject?.path ?? `apps/${app}/argo-${app}.Project.yaml`;

  const desiredDestinations: Array<{ namespace: string; server: string }> = [];
  const seenDest = new Set<string>();
  for (const target of inputs.targets) {
    const namespace = `${target.tenant}-${app}-${target.env}`;
    const key = `${namespace}\0${target.cluster_url}`;
    if (!seenDest.has(key)) {
      seenDest.add(key);
      desiredDestinations.push({ namespace, server: target.cluster_url });
    }
  }

  if (!existingAppProject) {
    const annotations: Record<string, string> = {
      'notifications.argoproj.io/subscribe.on-deployed.github':
        'fs-argocd-notifications',
      'notifications.argoproj.io/subscribe.on-health-degraded.github':
        'fs-argocd-notifications',
      'notifications.argoproj.io/subscribe.on-sync-failed.github':
        'fs-argocd-notifications',
    };
    if (inputs.slack_channel) {
      annotations['notifications.argoproj.io/subscribe.on-sync-failed.slack'] =
        inputs.slack_channel;
      annotations[
        'notifications.argoproj.io/subscribe.on-health-degraded.slack'
      ] = inputs.slack_channel;
    }

    const obj = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'AppProject',
      metadata: {
        name: expectedName,
        namespace: 'argocd',
        annotations,
      },
      spec: {
        description: `${app} State Project`,
        sourceRepos: [expectedRepoUrl],
        destinations: desiredDestinations,
        clusterResourceWhitelist: CLUSTER_RESOURCE_WHITELIST,
      },
    };
    validateVendorDoc('argocd-appproject', obj, vendorDir);
    return {
      path,
      content: YAML.stringify(obj),
      outcome: { kind: 'create' },
    };
  }

  const existingContent = existingAppProject.content;
  const doc = YAML.parseDocument(existingContent);
  if (doc.errors.length > 0) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Malformed YAML in ${path}: ${doc.errors[0].message}`,
      },
    };
  }

  const parsed: unknown = doc.toJS();
  if (!isRecord(parsed)) {
    return {
      path,
      outcome: { kind: 'conflict', reason: `Expected YAML mapping in ${path}` },
    };
  }

  if (parsed.kind !== 'AppProject') {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected kind "AppProject", found "${String(parsed.kind ?? '')}"`,
      },
    };
  }

  const metadata = isRecord(parsed.metadata) ? parsed.metadata : undefined;
  if (metadata?.name !== expectedName) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected metadata.name "${expectedName}", found "${String(metadata?.name ?? '')}"`,
      },
    };
  }

  const spec = isRecord(parsed.spec) ? parsed.spec : undefined;
  const sourceRepos =
    spec && Array.isArray(spec.sourceRepos) ? spec.sourceRepos : [];
  if (!sourceRepos.includes(expectedRepoUrl)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `spec.sourceRepos does not contain "${expectedRepoUrl}"`,
      },
    };
  }

  const specNode = doc.get('spec', true);
  if (!(specNode instanceof YAMLMap)) {
    return {
      path,
      outcome: { kind: 'conflict', reason: `Missing spec mapping in ${path}` },
    };
  }

  const rawDests: unknown = specNode.get('destinations', true);
  if (specNode.has('destinations') && !(rawDests instanceof YAMLSeq)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected "destinations" to be a YAML sequence in ${path}`,
      },
    };
  }
  let destsSeq: YAMLSeq;
  if (rawDests instanceof YAMLSeq) {
    destsSeq = rawDests;
  } else {
    destsSeq = doc.createNode([]);
    specNode.set('destinations', destsSeq);
  }

  const existingDestinations = new Set<string>();
  for (const item of destsSeq.items) {
    if (item instanceof YAMLMap) {
      const ns = item.get('namespace');
      const srv = item.get('server');
      if (typeof ns === 'string' && typeof srv === 'string') {
        existingDestinations.add(`${ns}\0${srv}`);
      }
    }
  }

  if (existingClusterValues) {
    for (const target of inputs.targets) {
      const existingUrl = existingClusterValues[target.platform];
      if (existingUrl !== undefined && existingUrl !== target.cluster_url) {
        const namespace = `${target.tenant}-${app}-${target.env}`;
        if (existingDestinations.has(`${namespace}\0${existingUrl}`)) {
          return {
            path,
            outcome: {
              kind: 'conflict',
              reason: `Destination "${namespace}" for cluster "${target.platform}" has server "${existingUrl}", expected "${target.cluster_url}"`,
            },
          };
        }
      }
    }
  }

  const added: string[] = [];
  for (const dest of desiredDestinations) {
    const key = `${dest.namespace}\0${dest.server}`;
    if (!existingDestinations.has(key)) {
      destsSeq.add(doc.createNode(dest));
      existingDestinations.add(key);
      added.push(`destination:${dest.namespace}`);
    }
  }

  if (added.length === 0) {
    return {
      path,
      content: existingContent,
      outcome: { kind: 'noop' },
    };
  }

  const validationErrors = validateVendorDocErrors(
    'argocd-appproject',
    doc.toJS(),
    vendorDir,
  );
  if (validationErrors) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Merged ${path} failed schema validation: ${validationErrors.join('; ')}`,
      },
    };
  }
  return {
    path,
    content: preserveEol(doc.toString(), existingContent),
    outcome: { kind: 'merge', added },
  };
}

export function renderStateArgocd(
  options: RenderStateArgocdOptions,
): RenderedArgocdFiles {
  const existingClusterValues = extractExistingClusterValues(
    options.existingApplicationSet,
  );
  return {
    applicationSet: renderApplicationSet(options),
    appProject: renderAppProject(options, existingClusterValues),
  };
}
