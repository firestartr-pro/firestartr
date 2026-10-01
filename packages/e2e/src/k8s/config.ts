import fsSync from 'node:fs';
import path from 'node:path';
import * as k8s from '@kubernetes/client-node';
import type { KubeconfigSource, KubeConfigProvider } from './types';

import log from '../logger';

// Load kubeconfig from various sources (path or default).
export function loadKubeConfig(source?: KubeconfigSource): k8s.KubeConfig {
  log.info(
    `Loading kubeconfig from source: ${source ? source.path : 'default location'}`,
  );

  const kubeConfig = new k8s.KubeConfig();

  if (!source) {
    log.debug('No kubeconfig source provided, loading from default location');
    const isInCluster =
      process.env.KUBERNETES_SERVICE_HOST &&
      process.env.KUBERNETES_SERVICE_PORT &&
      fsSync.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
    if (isInCluster) {
      log.debug('Loading from in-cluster configuration');
      kubeConfig.loadFromCluster();
    } else {
      log.debug('Not in a cluster, loading from default kubeconfig');
      kubeConfig.loadFromDefault();
    }
  } else {
    kubeConfig.loadFromFile(source.path);
  }

  return kubeConfig;
}

// Create a provider function that resolves and loads kubeconfig lazily.
export function createKubeConfigProvider(options: {
  kubeconfig?: string;
  kubeconfigContext?: string;
}): KubeConfigProvider {
  return () => {
    const source = resolveKubeconfigSource(options);
    const kubeConfig = loadKubeConfig(source);

    const context =
      options.kubeconfigContext ?? process.env.E2E_KUBECONFIG_CONTEXT;
    if (context) {
      const available = kubeConfig.getContexts().map((ctx) => ctx.name);
      if (!available.includes(context)) {
        throw new Error(
          `Kubeconfig context '${context}' not found. Available contexts: ${available.join(', ')}`,
        );
      }

      kubeConfig.setCurrentContext(context);
    }

    return kubeConfig;
  };
}

// Resolve kubeconfig source from options or environment variables.
export function resolveKubeconfigSource(options: {
  kubeconfig?: string;
}): KubeconfigSource | undefined {
  if (options.kubeconfig) {
    return { path: resolveKubeconfigPath(options.kubeconfig) };
  }

  const envValue = process.env.E2E_KUBECONFIG;
  if (envValue) {
    return { path: resolveKubeconfigPath(envValue) };
  }

  return undefined;
}

function resolveKubeconfigPath(input: string): string {
  if (!fsSync.existsSync(input)) {
    throw new Error(`Kubeconfig path does not exist: ${input}`);
  }

  const stat = fsSync.statSync(input);
  if (stat.isFile()) {
    return input;
  }

  if (stat.isDirectory()) {
    const candidate = path.join(input, 'config');
    if (!fsSync.existsSync(candidate)) {
      throw new Error(
        `Kubeconfig directory does not contain config file: ${input}`,
      );
    }

    const candidateStat = fsSync.statSync(candidate);
    if (!candidateStat.isFile()) {
      throw new Error(`Kubeconfig path is not a file: ${candidate}`);
    }

    return candidate;
  }

  throw new Error(`Kubeconfig path is not a file or directory: ${input}`);
}
