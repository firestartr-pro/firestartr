// we need to create a function that only performs the following steps:
// 1. similar to importGithubGitopsRepository
// 2. takes al the crs resulting
// 3. performs two annotations import needs-re-import

import fs from 'node:fs/promises';
import path from 'path';
import common from 'catalog_common';

import { applyCollectionMixins } from './decanter/collections';

import log from './logger';

// let's import the ICollection interface and create a class that implements it,
// we will use it to filter the crs with the generated filters, if they pass we annotate them with needs-re-import,
// then we write them back to the file system
// copilot is not finding the ICollection interface, so we need to import it from the collections file
//
import type { ICollection } from './decanter/collections';

const KIND_TO_COLLECTION_FILTERS: any = {
  FirestartrGithubRepository: 'gh-repo',
  FirestartrGithubGroup: 'gh-group',
  FirestartrGithubMembership: 'gh-members',
  FirestartrGithubOrganizationSettings: 'gh-org-settings',
};

const DEPENDANT_KINDS: any = [
  'FirestartrGithubRepositoryFeature',
  'FirestartrGithubRepositorySecretsSection',
];

// we create a special Collection that will use
class ReimportCollection {
  helperNameExtractor(cr: any) {
    if (cr.kind === 'FirestartrGithubOrganizationSettings') {
      return cr.spec.org;
    }

    return cr.metadata.annotations['firestartr.dev/external-name'];
  }

  isSkipped(cr: any, generatedFilters: any[]): boolean {
    if (cr.kind in KIND_TO_COLLECTION_FILTERS) {
      return this.IS_SKIP_SET(
        generatedFilters,
        KIND_TO_COLLECTION_FILTERS[cr.kind],
      );
    } else {
      return false;
    }
  }

  isCrIncluded(cr: any, generatedFilters: any[]): Promise<boolean> {
    if (this.isSkipped(cr, generatedFilters)) {
      return Promise.resolve(false);
    }

    if (cr.kind in KIND_TO_COLLECTION_FILTERS) {
      return this.filter(
        KIND_TO_COLLECTION_FILTERS[cr.kind],
        generatedFilters,
        [this.helperNameExtractor(cr)],
      ).then((result) => {
        return result.length > 0;
      });
    } else {
      return Promise.resolve(false);
    }
  }
}

interface ReimportCollection extends ICollection {}

applyCollectionMixins(ReimportCollection);

export async function reimportGithubGitopsRepository(
  org,

  crsPath,

  configPath,

  generatedFilters,
) {
  const collection = new ReimportCollection();

  const importAnnotation: string =
    common.generic.getFirestartrAnnotation('import');

  const reImportAnnotation: string =
    common.generic.getFirestartrAnnotation('needs-re-import');

  const reconcileAtAnnotation: string =
    common.generic.getFirestartrAnnotation('reconcile-at');

  const crsWithDependenciesToAnnotate: any[] = [];

  // we need to perform a search in all the crsPath
  await searchCRs(crsPath, async (cr, filePath) => {
    log.debug(`${JSON.stringify(cr)}`);

    // lets filter the cr with the generated filters, if it passes we annotate it with needs-re-import
    if (await collection.isCrIncluded(cr, generatedFilters)) {
      log.info(
        `Annotating ${cr.kind}/${cr.metadata.name} with ${reImportAnnotation} and ${importAnnotation}`,
      );

      if (cr.kind === 'FirestartrGithubRepository') {
        crsWithDependenciesToAnnotate.push(cr);
      }

      // we annotate the cr with needs-re-import
      if (!cr.metadata.annotations) {
        cr.metadata.annotations = {};
      }

      cr.metadata.annotations[reImportAnnotation] = 'true';
      cr.metadata.annotations[importAnnotation] = 'true';
      // we set an annotation to trigger the update
      cr.metadata.annotations[reconcileAtAnnotation] = new Date()
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z'); // exact format: 2026-04-19T20:45:00Z

      // we write the cr back to the file system
      const newContent = common.io.toYaml(cr);
      await fs.writeFile(filePath, newContent, 'utf-8');
    }
  });

  // we need to search for dependencies if proceeds
  if (!collection.IS_SKIP_SET(generatedFilters, 'gh-repo')) {
    log.info(
      `Searching for dependencies to annotate with ${reImportAnnotation} and ${importAnnotation}`,
    );
    await searchForDependencies(
      org,
      crsPath,
      configPath,
      generatedFilters,
      crsWithDependenciesToAnnotate,
      reImportAnnotation,
      importAnnotation,
      reconcileAtAnnotation,
    );
  }
}

async function searchForDependencies(
  org: string,
  crsPath: string,
  configPath: string,
  generatedFilters: any[],
  crsWithDependenciesToAnnotate: any[],
  reImportAnnotation: string,
  importAnnotation: string,
  reconcileAtAnnotation: string,
) {
  // we need to perform a search in all the crsPath
  await searchCRs(crsPath, async (cr, filePath) => {
    log.debug(`${JSON.stringify(cr)}`);

    if (DEPENDANT_KINDS.includes(cr.kind)) {
      if ('spec' in cr && 'repositoryTarget' in cr.spec) {
        const repositoryTarget = cr.spec.repositoryTarget as any;

        const isDependent = crsWithDependenciesToAnnotate.some((repoCr) => {
          return repositoryTarget.ref.name === repoCr.metadata.name;
        });

        if (isDependent) {
          log.info(
            `Found dependency ${cr.kind}/${cr.metadata.name} for repository ${repositoryTarget.ref.name}`,
          );
          // we annotate the cr with needs-re-import
          if (!cr.metadata.annotations) {
            cr.metadata.annotations = {};
          }

          cr.metadata.annotations[reImportAnnotation] = 'true';
          cr.metadata.annotations[importAnnotation] = 'true';

          // we set an annotation to trigger the update
          cr.metadata.annotations[reconcileAtAnnotation] = new Date()
            .toISOString()
            .replace(/\.\d{3}Z$/, 'Z'); // exact format: 2026-04-19T20:45:00Z

          // we write the cr back to the file system
          const newContent = common.io.toYaml(cr);
          await fs.writeFile(filePath, newContent, 'utf-8');
        }
      }
    }
  });
}

async function searchCRs(dirname: string, functionToApply: Function) {
  const files = await fs.readdir(dirname);

  for (const file of files) {
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      log.debug(`Processing file: ${file}`);

      const filePath = path.join(dirname, file);

      const content = await fs.readFile(filePath, 'utf-8');

      // let's use the catalog_common yaml loader
      const cr = common.io.fromYaml(content);

      // let's check if the file is a valid file (i.e a CR)
      if (!('kind' in cr) || !('metadata' in cr) || !('name' in cr.metadata)) {
        log.debug(`File ${filePath} is not a valid CR, skipping...`);
        continue;
      }

      await functionToApply(cr, filePath);
    } else if (await isDirectory(path.join(dirname, file))) {
      await searchCRs(path.join(dirname, file), functionToApply);
    }
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory(); //
  } catch (err) {
    return false;
  }
}
