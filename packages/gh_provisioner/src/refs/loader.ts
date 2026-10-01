import common from 'catalog_common';
import { readFile } from 'node:fs/promises';

import log from '../logger';

export type Dependency = {
  cr: any;
  secret: any;
};

export type Dependencies = { [key: string]: Dependency };

export async function loadDependencies(
  depsPath: string,
): Promise<Dependencies> {
  try {
    const deps: any = common.io.fromYaml(await readFile(depsPath, 'utf8'));

    return deps as Dependencies;
  } catch (err) {
    log.error(`Error loading deps file ${depsPath}: ${err}`);

    throw new Error(`Error loading deps file: ${depsPath}: ${err}`);
  }
}
