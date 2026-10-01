import fs from 'fs';
import path from 'path';

import { Testing, YamlOutputType } from 'cdk8s';

import {
  AllowedProviders,
  configureProvider,
  reconfigureProvider,
  setExcludedPaths,
  setPath,
} from '../src/config';
import { resetLazyLoader } from '../src/loader/lazy_loader';
import { render } from '../src/renderer/renderer';
import type { RenderedCrMap } from '../src/renderer/types';
import { emptyRenderedClaims } from '../src/refresolver';
import { renameVariantCrFiles } from '../src/renderer/claims-render';
import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';
import {
  createTestContext as createBaseTestContext,
  type CreateTestContextOptions,
  type TestContext,
} from '../src/utils/auxiliar';

export type {
  CreateTestContextOptions,
  TestContext,
} from '../src/utils/auxiliar';

type RenderSource =
  | { entries: string[] }
  | { claimRefs: string[] }
  | { generator: AsyncGenerator<string, void, unknown> };

type RenderOptions = {
  crsPath?: string;
  excludeGithubCrs?: boolean;
};

export interface RendererTestContext extends TestContext {
  resetRendererState: () => Promise<RendererTestContext>;
  configureRendererPaths: (options?: RenderOptions) => void;
  createRendererApps: () => {
    catalogApp: ReturnType<typeof Testing.app>;
    app: ReturnType<typeof Testing.app>;
  };
  renderClaims: (
    source?: RenderSource,
    options?: RenderOptions,
  ) => Promise<{
    catalogApp: ReturnType<typeof Testing.app>;
    app: ReturnType<typeof Testing.app>;
    renderedMap: RenderedCrMap;
  }>;
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const DEFAULT_INITIALIZERS_DIR = path.join(FIXTURES_DIR, 'initializers');
const DEFAULT_GLOBALS_DIR = path.join(FIXTURES_DIR, 'globals');
const DEFAULT_CRS_DIR = path.join(FIXTURES_DIR, 'crs');
const DEFAULT_NO_CRS_DIR = path.join(FIXTURES_DIR, 'nocrs');
const GITHUB_CRS_EXCLUDED_PATH = path.join(FIXTURES_DIR, 'crs/.github');
const CLAIMS_DEFAULTS_FILE = 'claims_defaults.yaml';

let providerConfigured = false;

export function ensureTestProviderConfigured(
  provider = AllowedProviders.all,
): void {
  if (!providerConfigured) {
    try {
      configureProvider(provider);
    } catch {
      reconfigureProvider(provider);
    }

    providerConfigured = true;
  }
}

export async function createTestContext(
  options: CreateTestContextOptions = {},
): Promise<RendererTestContext> {
  ensureTestProviderConfigured();

  const baseContext = await createBaseTestContext(options);

  const attachRendererMethods = (
    context: TestContext,
  ): RendererTestContext => ({
    ...context,

    resetRendererState: async () => {
      emptyRenderedClaims();
      resetLazyLoader();

      return attachRendererMethods(await context.restart());
    },

    configureRendererPaths: ({
      crsPath = DEFAULT_CRS_DIR,
      excludeGithubCrs = false,
    }: RenderOptions = {}) => {
      setPath('initializers', DEFAULT_INITIALIZERS_DIR);
      setPath('crs', crsPath);
      setPath('globals', DEFAULT_GLOBALS_DIR);
      setPath('claims', context.getClaimsDir());

      const tempClaimsDefaultsPath = path.join(
        context.getInitializersDir(),
        CLAIMS_DEFAULTS_FILE,
      );
      const claimsDefaultsPath = fs.existsSync(tempClaimsDefaultsPath)
        ? context.getInitializersDir()
        : DEFAULT_INITIALIZERS_DIR;

      setPath('claimsDefaults', claimsDefaultsPath);

      const excludedPaths = excludeGithubCrs
        ? [GITHUB_CRS_EXCLUDED_PATH]
        : [];

      setExcludedPaths(excludedPaths);
    },

    createRendererApps: () => ({
      catalogApp: Testing.app({
        outdir: context.getCatalogOutDir(),
        outputFileExtension: '.yaml',
        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
      }),
      app: Testing.app({
        outdir: context.getResourcesOutDir(),
        outputFileExtension: '.yaml',
        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
      }),
    }),

    renderClaims: async (
      source: RenderSource = { entries: [context.getClaimsDir()] },
      options: RenderOptions = {},
    ) => {
      emptyRenderedClaims();
      resetLazyLoader();

      const { crsPath = DEFAULT_CRS_DIR, excludeGithubCrs = false } = options;

      attachRendererMethods(context).configureRendererPaths({
        crsPath,
        excludeGithubCrs,
      });

      const { catalogApp, app } = attachRendererMethods(context).createRendererApps();

      let claimSource: AsyncGenerator<string, void, unknown>;

      if ('generator' in source) {
        claimSource = source.generator;
      } else if ('claimRefs' in source) {
        claimSource = claimsRefListAsGenerator(source.claimRefs);
      } else {
        claimSource = resolveClaimEntries(source.entries);
      }

      const renderedMap = await render(catalogApp, app, claimSource);

      app.synth();
      catalogApp.synth();

      renameVariantCrFiles(context.getResourcesOutDir(), renderedMap);

      return { catalogApp, app, renderedMap };
    },
  });

  return attachRendererMethods(baseContext);
}

export const rendererTestFixtures = {
  crs: DEFAULT_CRS_DIR,
  globals: DEFAULT_GLOBALS_DIR,
  initializers: DEFAULT_INITIALIZERS_DIR,
  noCrs: DEFAULT_NO_CRS_DIR,
};
