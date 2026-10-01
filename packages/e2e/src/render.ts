import fs from 'node:fs/promises';
import path from 'node:path';

import { App, YamlOutputType } from 'cdk8s';
import { render } from 'render/src/renderer/renderer';
import { resolveClaimEntries } from 'render/src/utils/claimUtils';
import {
  AllowedProviders,
  configureProvider,
  reconfigureProvider,
  setExcludedPaths,
  setPath,
} from 'render/src/config';
import { emptyRenderedClaims } from 'render/src/refresolver';
import { resetLazyLoader } from 'render/src/loader/lazy_loader';

export interface RenderClaimsOptions {
  initializers: string;
  globals: string;
  claims: string;
  claimsDefaults: string;
  claimEntries?: string[];
  excludedPaths?: string[];
  provider?: AllowedProviders;
  previousCrsPath?: string;
}

export interface RenderClaimsResult {
  catalogPath: string;
  crsPath: string;
}

let providerConfigured = false;

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function seedCrsDirectory(
  sourcePath: string | undefined,
  targetPath: string,
): Promise<void> {
  if (!sourcePath || sourcePath === targetPath) return;
  if (!(await pathExists(sourcePath))) return;

  await fs.cp(sourcePath, targetPath, { recursive: true });
}

export async function renderClaims(
  outputPath: string,
  options: RenderClaimsOptions,
): Promise<RenderClaimsResult> {
  const provider = options.provider ?? AllowedProviders.all;

  // The renderer keeps several caches in module-level state. Reset them all
  // before each render so one renderLocally call cannot leak state into the next.
  emptyRenderedClaims();
  resetLazyLoader();

  // The renderer keeps provider config in module-level state. Reconfigure on
  // subsequent calls so one test run cannot leak provider selection into the
  // next one.
  if (providerConfigured) {
    reconfigureProvider(provider);
  } else {
    configureProvider(provider);
    providerConfigured = true;
  }

  const catalogPath = path.join(outputPath, 'catalog');
  const crsPath = path.join(outputPath, 'crs');

  await ensureDir(catalogPath);
  await ensureDir(crsPath);
  await seedCrsDirectory(options.previousCrsPath, crsPath);

  setPath('initializers', options.initializers);
  setPath('globals', options.globals);
  setPath('claims', options.claims);
  setPath('claimsDefaults', options.claimsDefaults);
  setPath('crs', crsPath);

  if (options.excludedPaths && options.excludedPaths.length > 0) {
    setExcludedPaths(options.excludedPaths);
  }

  const catalogApp = new App({
    outdir: catalogPath,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  const firestartrApp = new App({
    outdir: crsPath,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  const claimRefs = resolveClaimEntries(
    options.claimEntries ?? [options.claims],
  );

  await render(catalogApp, firestartrApp, claimRefs);

  catalogApp.synth();
  firestartrApp.synth();

  return { catalogPath, crsPath };
}
