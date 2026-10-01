import { GlobalSectionError } from './base';
import common from 'catalog_common';
import * as fs from 'fs';
import * as path from 'path';
import { BranchStrategiesExpander } from './branchStrategies';
import { TechnologyGlobal } from './technology';
import { GlobalDefault } from '../defaults/global';
import BranchStrategiesSchema from '../schemas/branch_strategies';
import TechnologySchema from '../schemas/technologies';
import DefaultSchema from '../schemas/default';

export const SECTIONS: any[] = [];

export const SECTIONS_BY_FILE_NAME: any = {
  [BranchStrategiesExpander.FILE_NAME()]: BranchStrategiesExpander,

  [TechnologyGlobal.FILE_NAME()]: TechnologyGlobal,

  global_github_repository: GlobalDefault,
};

export const SCHEMAS_BY_SECTION_NAME: any = {
  [BranchStrategiesExpander.FILE_NAME()]: BranchStrategiesSchema,

  [TechnologyGlobal.FILE_NAME()]: TechnologySchema,

  global_github_repository: DefaultSchema,
};

export async function getGlobals(claim: any, previousCR: any) {
  const globalsPatches: any[] = [];

  for (const globalObject of SECTIONS) {
    const section = new globalObject();

    globalsPatches.push(await section.patches(claim, previousCR));
  }

  return globalsPatches;
}

export async function getGlobalFiles(
  globalsPath: string,

  claim: any,

  previousCR: any,
) {
  const fileList: string[] = common.io.getFileListRecursively(
    globalsPath,
    [],
    ['.yaml', '.yml'],
  );

  const globalPatches: any[] = [];

  for (const filePath of fileList) {
    const ext: string = path.extname(filePath);

    const name: string = path.basename(filePath, ext);

    const data: any = common.io.fromYaml(fs.readFileSync(filePath, 'utf-8'));

    const section = new SECTIONS_BY_FILE_NAME[name](data);

    const isValid: boolean = await section.validate();

    if (!isValid) {
      throw new GlobalSectionError(`${filePath} is not a valid globals file`);
    }

    globalPatches.push(await section.patches(claim, previousCR));
  }

  return globalPatches;
}
