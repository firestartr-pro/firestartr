import YAML from 'yaml';

import { isNotFoundError } from '../github/api.js';
import { isRecord } from '../utils/isRecord.js';

import type { GitHubApi } from '../github/api.js';

export interface DiscoveredCluster {
  name: string;
  url: string;
}

export interface ArgoCdFacts {
  present: boolean;
  clusters: DiscoveredCluster[];
  slackChannel?: string;
}

const SLACK_ANNOTATION_RE =
  /^notifications\.argoproj\.io\/subscribe\..*\.slack$/;

function isYamlPath(path: string): boolean {
  return path.endsWith('.yaml') || path.endsWith('.yml');
}

function extractClusterPair(
  record: Record<string, unknown>,
): DiscoveredCluster | null {
  const url =
    (typeof record.server === 'string' && record.server) ||
    (typeof record.clusterUrl === 'string' && record.clusterUrl) ||
    (typeof record.cluster_url === 'string' && record.cluster_url) ||
    (typeof record.url === 'string' && record.url) ||
    '';
  if (!url) return null;

  const name =
    (typeof record.cluster === 'string' && record.cluster) ||
    (typeof record.clusterName === 'string' && record.clusterName) ||
    (typeof record.cluster_name === 'string' && record.cluster_name) ||
    (typeof record.name === 'string' && record.name) ||
    url;
  return { name, url };
}

function collectGeneratorClusters(
  generators: unknown,
  out: DiscoveredCluster[],
): void {
  if (!Array.isArray(generators)) return;
  for (const gen of generators) {
    if (!isRecord(gen)) continue;

    if (isRecord(gen.git) && isRecord(gen.git.values)) {
      const pair = extractClusterPair(gen.git.values);
      if (pair) out.push(pair);
    }
    if (isRecord(gen.list) && Array.isArray(gen.list.elements)) {
      for (const element of gen.list.elements) {
        if (!isRecord(element)) continue;
        const pair = extractClusterPair(element);
        if (pair) out.push(pair);
      }
    }
    if (isRecord(gen.matrix)) {
      collectGeneratorClusters(gen.matrix.generators, out);
    }
    if (isRecord(gen.merge)) {
      collectGeneratorClusters(gen.merge.generators, out);
    }
  }
}

function parseArgoCdDocuments(
  content: string,
  clusters: DiscoveredCluster[],
  slackCounts: Map<string, number>,
): void {
  let docs: YAML.Document[];
  try {
    docs = YAML.parseAllDocuments(content);
  } catch {
    return;
  }

  for (const doc of docs) {
    const value: unknown = doc.toJS();
    if (!isRecord(value)) continue;

    if (value.kind === 'AppProject') {
      if (isRecord(value.spec) && Array.isArray(value.spec.destinations)) {
        for (const dest of value.spec.destinations) {
          if (!isRecord(dest) || typeof dest.server !== 'string') continue;
          const name =
            typeof dest.name === 'string' && dest.name.length > 0
              ? dest.name
              : dest.server;
          clusters.push({ name, url: dest.server });
        }
      }

      if (isRecord(value.metadata) && isRecord(value.metadata.annotations)) {
        for (const [key, raw] of Object.entries(value.metadata.annotations)) {
          if (!SLACK_ANNOTATION_RE.test(key) || typeof raw !== 'string') {
            continue;
          }
          for (const channel of raw
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)) {
            slackCounts.set(channel, (slackCounts.get(channel) ?? 0) + 1);
          }
        }
      }
    } else if (value.kind === 'ApplicationSet') {
      if (isRecord(value.spec)) {
        collectGeneratorClusters(value.spec.generators, clusters);
      }
    }
  }
}

function deduplicateClusters(
  clusters: DiscoveredCluster[],
): DiscoveredCluster[] {
  const seen = new Set<string>();
  const result: DiscoveredCluster[] = [];
  for (const cluster of clusters) {
    const key = `${cluster.name}\0${cluster.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cluster);
  }
  return result.sort(
    (a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url),
  );
}

function mostCommonChannel(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [channel, count] of counts.entries()) {
    if (
      count > bestCount ||
      (count === bestCount &&
        best !== undefined &&
        channel.localeCompare(best) < 0)
    ) {
      best = channel;
      bestCount = count;
    }
  }
  return best;
}

export async function readArgoCdFacts(
  api: GitHubApi,
  org: string,
): Promise<ArgoCdFacts> {
  const ref = { owner: org, repo: 'state-argocd' };
  const exists = await api.repoExists(ref);
  if (!exists) {
    return { present: false, clusters: [] };
  }

  let branch: string;
  let paths: string[];
  try {
    branch = await api.getDefaultBranch(ref);
    paths = await api.listBlobPaths(ref, branch);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { present: false, clusters: [] };
    }
    throw error;
  }

  const yamlPaths = paths.filter(isYamlPath).sort();
  const files = await Promise.all(
    yamlPaths.map((p) => api.readFile(ref, p, branch)),
  );

  const clusters: DiscoveredCluster[] = [];
  const slackCounts = new Map<string, number>();

  for (const file of files) {
    if (!file) continue;
    parseArgoCdDocuments(file.content, clusters, slackCounts);
  }

  const slackChannel = mostCommonChannel(slackCounts);
  return {
    present: true,
    clusters: deduplicateClusters(clusters),
    ...(slackChannel !== undefined ? { slackChannel } : {}),
  };
}
