import { DEFAULT_E2E_ORG } from '../constants';
import { createKubeConfigProvider } from '../k8s/config';
import { normalizeNamePrefix } from '../names';
import { createClaimsApi } from './claims-api';
import { createGhApi } from './gh-api';
import { registerE2EState } from './internal-state';
import { createK8sApi } from './k8s-api';
import { E2EState } from './state';

import type { E2EApi, E2EInitOptions } from '../types';

import log from '../logger';

function resolveOrg(input?: string): string {
  return input ?? process.env.E2E_ORG ?? DEFAULT_E2E_ORG;
}

function resolveNamespace(input?: string): string {
  return input ?? process.env.E2E_NAMESPACE ?? 'default';
}

export async function initE2e(
  org?: string,
  namespace?: string,
  options: E2EInitOptions = {},
): Promise<E2EApi> {
  const resolvedOrg = resolveOrg(org);
  const resolvedNamespace = resolveNamespace(namespace);
  const resolvedPrefix = normalizeNamePrefix(options.namePrefix);

  log.info(
    `Initializing E2E client with org: ${resolvedOrg}, namespace: ${resolvedNamespace}, prefix: ${resolvedPrefix}`,
  );

  // The shared github workspace package still reads ORG from process env in
  // some paths, so we keep this synchronized with the runtime state.
  process.env.ORG = resolvedOrg;

  const kubeConfigProvider = createKubeConfigProvider({
    kubeconfig: options.kubeconfig,
    kubeconfigContext: options.kubeconfigContext,
  });

  const state = new E2EState({
    org: resolvedOrg,
    namespace: resolvedNamespace,
    prefix: resolvedPrefix,
    kubeConfigProvider,
    fixturesBasePath: options.fixturesBasePath,
    onlyFiles: options.onlyFiles,
  });

  const claims = createClaimsApi(state);
  const k8s = createK8sApi(state);
  const gh = createGhApi(state);

  const client: E2EApi = {
    getPrefix(): string {
      return state.prefix;
    },

    setPrefix(prefix: string): void {
      state.prefix = normalizeNamePrefix(prefix);
      state.lastRenderedCrsPath = undefined;
    },

    getOrg(): string {
      return state.org;
    },

    setOrg(nextOrg: string): void {
      state.org = nextOrg;
      process.env.ORG = nextOrg;
    },

    claims,
    k8s,
    gh,
  };

  registerE2EState(client, state);

  return client;
}
