import { getPath, getKindPath, fromYaml } from './common';

import * as path from 'path';
import * as fs from 'fs';

import log from '../logger';

export default function readEntity(
  kind: string,
  name: string,
  catalogPaths: string[] | string,
) {
  try {
    if (typeof catalogPaths === 'string') {
      catalogPaths = [catalogPaths];
    }

    let data: any = false;

    for (const catalogPath of catalogPaths) {
      try {
        log.debug(`Reading entity ${kind}/${name} from catalog ${catalogPath}`);

        const entityPath = getPath(kind, name, catalogPath);

        if (fs.existsSync(entityPath)) {
          if (data) {
            throw 'DUPLICATED';
          }
          data = fs.readFileSync(entityPath, { encoding: 'utf8' });
        }
      } catch (err) {
        log.debug('readEntity: cached error %s', err);

        if (err === 'DUPLICATED') {
          throw `Error reading entity: Duplicated ${kind}/${name} in ${catalogPaths.join(', ')}`;
        }
      }
    }

    if (!data) {
      throw `Error reading entity: ${kind}/${name}: not found in ${catalogPaths.join(', ')}`;
    }

    return fromYaml(data);
  } catch (err) {
    log.error(err);

    throw `readEntity->: ${kind}/${name}: ${err}`;
  }
}

export function listByKind(
  kind: string,
  catalogPaths: string | string[],
  callback: Function,
  exclude: Array<string> = [],
) {
  if (typeof catalogPaths === 'string') {
    catalogPaths = [catalogPaths];
  }

  log.debug(`CATALOGS_PATHS_ ${catalogPaths}`);

  const list: any[] = [];

  catalogPaths.forEach((catalogPath: string) => {
    list.push(...fs.readdirSync(getKindPath(kind, catalogPath)));
  });

  log.debug(`LIST_ ${list}`);

  log.debug(`Listing entities of kind ${kind} from catalogs`);

  return list
    .filter((file: string) => file.match(/\.yaml$/))
    .filter(
      (file: string) => exclude.indexOf(file.replace(/\.yaml/, '')) === -1,
    )
    .map((file: string) =>
      readEntity(kind, file.replace(/\.yaml/, ''), catalogPaths),
    )
    .filter((entity: any) => callback(entity));
}

export function getFileListRecursively(
  pathToCheck: string,
  filePathList: string[] = [],
  fileExList?: string[],
) {
  const fileStats = fs.statSync(pathToCheck);
  if (fileStats.isFile()) {
    if (fileExList) {
      const extension: string = path.extname(pathToCheck);
      if (fileExList.indexOf(extension) > -1) {
        filePathList.push(pathToCheck);
      }
    } else {
      filePathList.push(pathToCheck);
    }
  } else {
    for (const file of fs.readdirSync(pathToCheck)) {
      filePathList = getFileListRecursively(
        path.join(pathToCheck, file),
        filePathList,
        fileExList,
      );
    }
  }
  return filePathList;
}
