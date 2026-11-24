import { readArgoCdFacts } from './argocd.js';
import { readDotFirestartr } from './dotFirestartr.js';
import { readServiceFacts } from './serviceFacts.js';

import type { ArgoCdFacts } from './argocd.js';
import type { DotFirestartrFacts } from './dotFirestartr.js';
import type { ServiceFacts } from './serviceFacts.js';
import type { GitHubApi } from '../github/api.js';
import type { FeatureSource } from '../utils/featureSource.js';

export interface AppDiscoverResult {
  org: string;
  app: string;
  service: string;
  dotFirestartr: DotFirestartrFacts;
  argocd: ArgoCdFacts;
  serviceFacts: ServiceFacts;
}

export interface DiscoverAppOptions {
  api: GitHubApi;
  org: string;
  claimsRepoName: string;
  app: string;
  service?: string;
  featureSource?: FeatureSource;
}

function inferServiceName(
  explicitService: string | undefined,
  dotFirestartr: DotFirestartrFacts,
  app: string,
): string {
  if (explicitService) return explicitService;
  if (!dotFirestartr.appConfig.present) {
    throw new Error(
      `Cannot infer --service: apps/${app}.yaml is absent in .firestartr. Pass --service <service>.`,
    );
  }
  const services = dotFirestartr.appConfig.services;
  if (services.length === 1) {
    return services[0].name;
  }
  if (services.length === 0) {
    throw new Error(
      `Cannot infer --service: apps/${app}.yaml lists no services. Pass --service <service>.`,
    );
  }
  const names = services.map((s) => s.name).join(', ');
  throw new Error(
    `Cannot infer --service: apps/${app}.yaml lists multiple services (${names}). Pass --service <service>.`,
  );
}

function collectCandidateEnvs(dotFirestartr: DotFirestartrFacts): string[] {
  const seen = new Set<string>();
  const envs: string[] = [];
  for (const platform of dotFirestartr.platforms) {
    for (const env of platform.envs) {
      if (!seen.has(env)) {
        seen.add(env);
        envs.push(env);
      }
    }
  }
  return envs;
}

export async function discoverApp(
  options: DiscoverAppOptions,
): Promise<AppDiscoverResult> {
  const { api, org, claimsRepoName, app, featureSource } = options;

  const [dotFirestartr, argocd] = await Promise.all([
    readDotFirestartr(api, org, app),
    readArgoCdFacts(api, org),
  ]);

  const service = inferServiceName(options.service, dotFirestartr, app);
  const appServices = dotFirestartr.appConfig.present
    ? dotFirestartr.appConfig.services.map((s) => s.name)
    : [];
  const candidateEnvs = collectCandidateEnvs(dotFirestartr);

  const serviceFacts = await readServiceFacts(api, {
    org,
    claimsRepoName,
    service,
    appServices,
    candidateEnvs,
    featureSource,
  });

  return {
    org,
    app,
    service,
    dotFirestartr,
    argocd,
    serviceFacts,
  };
}

export function formatDiscoverSummary(result: AppDiscoverResult): string {
  const lines: string[] = [];
  lines.push(
    `App: ${result.app} (org: ${result.org}, service: ${result.service})`,
  );

  if (!result.dotFirestartr.present) {
    lines.push('.firestartr: absent');
  } else {
    const platforms = result.dotFirestartr.platforms
      .map((p) => `${p.name} (${p.type || 'unknown'})`)
      .join(', ');
    const registries = result.dotFirestartr.registries
      .map((r) => (r.default ? `${r.name} [default]` : r.name))
      .join(', ');
    lines.push(`Platforms: ${platforms || 'none'}`);
    lines.push(`Registries: ${registries || 'none'}`);
    lines.push(
      `App config: ${result.dotFirestartr.appConfig.present ? 'present' : 'absent'}`,
    );
  }

  if (!result.argocd.present) {
    lines.push('ArgoCD state: absent');
  } else {
    const clusters = result.argocd.clusters
      .map((c) => `${c.name} -> ${c.url}`)
      .join(', ');
    lines.push(`Clusters: ${clusters || 'none'}`);
    if (result.argocd.slackChannel) {
      lines.push(`Slack channel: ${result.argocd.slackChannel}`);
    }
  }

  const sf = result.serviceFacts;
  lines.push(
    `Service claim: owner=${sf.owner ?? 'unset'}, system=${sf.system ?? 'unset'}${
      sf.ownerSystemDisagreement
        ? ' (disagreement with other app services)'
        : ''
    }`,
  );
  lines.push(
    `Release type: ${sf.releaseType.value} (${sf.releaseType.source})`,
  );

  const trackEntries = Object.entries(sf.tracks)
    .map(([env, track]) => `${env}=${track}`)
    .join(', ');
  lines.push(`Proposed tracks: ${trackEntries || 'none'}`);

  return lines.join('\n');
}
