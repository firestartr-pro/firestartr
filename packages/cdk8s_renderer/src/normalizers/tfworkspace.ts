import { crawl } from '../crawler';
import { ICustomResourcePatch } from '../patches';
import { Normalizer } from './base';
import * as _ from 'lodash';
import * as path from 'path';
import * as fsasync from 'fs/promises';

import {
  TerraformProviderAdditionalFile,
  TerraformProviderAdditionalFiles,
} from '../claims/tfworkspaces/tfworkspace';

import { FirestartrTerraformWorkspaceSpecFiles } from '../../imports/firestartr.dev';

export class TFWorkspaceNormalizer extends Normalizer {
  applicableProviders = ['terraform'];

  applicableKinds = ['TFWorkspaceClaim'];

  async __validate(_schema: any): Promise<boolean> {
    return true;
  }

  async __patches(
    claim: any,
    _previousCR: any,
  ): Promise<ICustomResourcePatch[]> {
    const claimPath = this.data.path;

    return [
      {
        validate(cr: any) {
          /**
           * Validate CR has minimum length and max due to kubernetes artifact limits
           */
          return validatek8sLimits(cr.spec['module']);
        },

        async apply(cr: any) {
          const source = claim.providers.terraform.source.toLowerCase();

          const moduleContent = claim.providers.terraform.module;

          if (source === 'inline' && !moduleContent) {
            const dirTfRootModule = path.dirname(claimPath);

            const normalizedContent =
              await normalizeModuleContent(dirTfRootModule);

            cr.spec['module'] = normalizedContent;
          }

          if ('files' in claim.providers.terraform) {
            try {
              const additionalFiles = await loadAdditionalFiles(
                claim.providers.terraform[
                  'files'
                ] as TerraformProviderAdditionalFiles,
                path.dirname(claimPath),
              );

              cr.spec['files'] = additionalFiles;
            } catch (err) {
              throw new Error(
                `Loading additional files for TFWorkspace: ${claim.name}: ${err && err.message ? err.message : err}`,
              );
            }
          }

          return cr;
        },

        identify() {
          return 'normalizer/tfworkspace';
        },
      },
    ];
  }
}

export async function normalizeModuleContent(tfRootModulePath: string) {
  let content = '';

  const files: Record<string, string> = {};

  await crawl(
    tfRootModulePath,

    // bring all files, not only tf
    (entry: string) => {
      return entry.endsWith('.tf');
    },

    (entry: string, data: string) => {
      files[entry] = data;
    },
  );

  Object.keys(files)
    .sort()
    .forEach((entry: string) => {
      content += `# ${path.basename(entry)}
${files[entry]}
`;
    });

  return content;
}

async function loadAdditionalFiles(
  files: TerraformProviderAdditionalFiles,
  tfRootModulePath: string,
): Promise<FirestartrTerraformWorkspaceSpecFiles[]> {
  const specFiles: FirestartrTerraformWorkspaceSpecFiles[] = [];

  for (const additionalFile of files) {
    const specFile: FirestartrTerraformWorkspaceSpecFiles = {
      path: additionalFile.destination,

      content: await loadAdditionalFile(
        additionalFile.source,

        tfRootModulePath,
      ),
    };

    specFiles.push(specFile);
  }

  return specFiles;
}

async function loadAdditionalFile(
  source: string,
  tfRootModulePath: string,
): Promise<string> {
  try {
    const filePath = path.join(tfRootModulePath, source);

    const stats = await fsasync.stat(filePath);

    if (!stats.isFile()) {
      throw new Error(`${source} is not a file`);
    }

    const content = await fsasync.readFile(filePath, {
      encoding: 'utf8',
    });

    return Buffer.from(content, 'utf8').toString('base64');
  } catch (err) {
    throw new Error(
      `Loading additional tfworkspace file ${source}: ${err && err.message ? err.message : err}`,
    );
  }
}

export function validatek8sLimits(moduleContent: any) {
  const moduleLength = moduleContent.length;

  return moduleLength > 0 && moduleLength < 750000;
}
