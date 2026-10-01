/**
 * Shared constants for E2E tests.
 */

import { DEFAULT_E2E_ORG, E2E_TEST_TIMEOUT } from './constants';

/** Default organization for E2E tests */
export { DEFAULT_E2E_ORG };

/** Provider config references */
export const BACKEND_PROVIDER_NAME =
  process.env.BACKEND_PROVIDER_NAME ?? 'tfstate-firestartr-e2e';
export const GITHUB_PROVIDER_NAME =
  process.env.GITHUB_PROVIDER_NAME ?? 'github-firestartr-e2e';
export const TF_BACKEND_PROVIDER_NAME =
  process.env.TF_BACKEND_PROVIDER_NAME ?? 'kubernetes-backend';
export const TF_PROVIDER_NAME = process.env.TF_PROVIDER_NAME ?? 'kubernetes';

export const PROVIDER_CONFIGS = {
  backend: {
    kind: 'FirestartrProviderConfig' as const,
    name: BACKEND_PROVIDER_NAME,
  },
  github: {
    kind: 'FirestartrProviderConfig' as const,
    name: GITHUB_PROVIDER_NAME,
  },
  tfBackend: {
    kind: 'FirestartrProviderConfig' as const,
    name: TF_BACKEND_PROVIDER_NAME,
  },
  tfProvider: {
    kind: 'FirestartrProviderConfig' as const,
    name: TF_PROVIDER_NAME,
  },
};

/** Wait timeout for a single rendered CR reconciliation (in seconds) */
export const WAIT_FOR_CR_TIMEOUT_SECONDS = 1200;

/** Jest timeout for local render/apply suites (in milliseconds) */
export const LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS =
  E2E_TEST_TIMEOUT + WAIT_FOR_CR_TIMEOUT_SECONDS * 1000;
