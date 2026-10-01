import { importGithubGitopsRepository, isInPreviousCRs } from './src/decanter';
import type { CollectionFilter } from './src/decanter/collections';
import { collections as Collections } from './src/decanter';
import { filtersBuilder } from './src/decanter/filters';
export type { CollectionFilter };
export default {
  importGithubGitopsRepository,
};
import { reimportGithubGitopsRepository } from './src/reimporter';
import common from 'catalog_common';
import cdk8s_renderer, { AllowedProviders } from 'cdk8s_renderer';
import { configureProvider } from 'cdk8s_renderer';

import {
  setClaimsDefaultsPath,
  loadClaimsDefaultsOnce,
} from './src/decanter/config';

export async function runImporter(
  force: boolean,
  skipPlan: boolean,
  claimsPath: string,
  crsPath: string,
  configPath: string,
  claimsDefaultsPath: string,
  org: string,
  filters: string[],
  provider: AllowedProviders = AllowedProviders.all,
  needsReimport = false,
) {
  configureProvider(provider);

  let generatedFilters: CollectionFilter[] = [];

  //gh-repo,REGEXP=.*vite.*
  cdk8s_renderer.setPath('claimsDefaults', claimsDefaultsPath);
  setClaimsDefaultsPath(claimsDefaultsPath);
  loadClaimsDefaultsOnce();

  generatedFilters = buildFilters(filters, force, crsPath, generatedFilters);

  if (needsReimport) {
    await reimportGithubGitopsRepository(
      org,

      crsPath,

      configPath,

      generatedFilters,
    );
  } else {
    await importGithubGitopsRepository(
      org,

      skipPlan,

      claimsPath,

      crsPath,

      configPath,

      generatedFilters,

      needsReimport,

      force,
    );
  }
}

function buildFilters(
  filters: string[],

  force: boolean,

  crsPath: string,

  generatedFilters: CollectionFilter[],
) {
  filters.push('all,FUNCTION=fCheckCRExistsOnDisk');

  /**
   * Create skip filters
   */
  generatedFilters = filtersBuilder(
    createSkipFilters(filters || []),

    {
      fCheckCRExistsOnDisk: async function (
        collectionKind: string,
        name: string,
      ) {
        if (force) return true;
        else {
          return !isInPreviousCRs(collectionKind, name);
        }
      },
    },
  );

  return generatedFilters;
}

function createSkipFilters(filters: string[]) {
  const crExistsFilter = 'all,FUNCTION=fCheckCRExistsOnDisk';
  const includedCollections: string[] = filters
    .filter((f: string) => f !== crExistsFilter)
    .map((f: string) => f.split(',')[0]);

  const allFilters = filters.filter(
    (f: string) => f.split(',')[0] === 'all' && f !== crExistsFilter,
  );
  const hasExplicitFilters = includedCollections.length > 0;

  for (const collectionClass of Object.values(Collections)) {
    const collectionKind = collectionClass.collectionKind;

    if (allFilters.length > 0 || !hasExplicitFilters) {
      for (const allFilter of [...allFilters, crExistsFilter]) {
        filters.push(allFilter.replace('all', collectionKind));
      }

      continue;
    }

    if (includedCollections.indexOf(collectionKind) === -1) {
      filters.push(`${collectionKind},SKIP=SKIP`);
      continue;
    }

    filters.push(crExistsFilter.replace('all', collectionKind));
  }

  return filters;
}
