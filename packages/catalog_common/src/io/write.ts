import * as fs from 'fs';
import * as path from 'path';
import { getPath, dumpYaml } from './common';
import { randomString } from '../generic/random';

import log from '../logger';

export function writeEntity(entity: any, path: string) {
  try {
    entity['metadata']['annotations']['fire-starter.dev/timestamp'] =
      Math.floor(Date.now() / 1000).toString();

    //If we have an status, we remove it

    log.debug(`Writing to catalog ${path} entity ${entity}`);
    fs.writeFileSync(
      getPath(entity['kind'], entity['metadata']['name'], path),
      dumpYaml(entity),
    );
  } catch (err) {
    log.error(`Error writing entity '${entity.kind}', error ${err}`);

    throw `writeEntity: ${entity.kind} ${err}`;
  }
}

export function writeClaim(claim: any, claimsPath: string) {
  try {
    const kindFolder = `${claim['kind']}s`.toLowerCase().replace('claim', '');

    log.debug(`Writing to gitops ${claimsPath}/${kindFolder} claim ${claim}`);

    fs.mkdirSync(path.join(claimsPath, kindFolder), { recursive: true });

    fs.writeFileSync(
      getPathClaim(claim['kind'], claim['name'], claimsPath),
      dumpYaml(claim),
    );
  } catch (err: any) {
    log.error(`Error writing claim, error ${err}`);

    throw `writeClaim: ${claim.kind} ${err}`;
  }
}

export function writeYamlFile(fileName: string, data: any, pathFile = '/tmp') {
  try {
    //check file has .yaml or .yml extension

    if (!fileName.endsWith('.yaml') && !fileName.endsWith('.yml')) {
      // add .yaml extension

      fileName = fileName + '.yaml';
    }

    if (!fs.existsSync(pathFile)) {
      fs.mkdirSync(pathFile, { recursive: true });
    }

    fs.writeFileSync(path.join(pathFile, fileName), dumpYaml(data));
  } catch (err: any) {
    log.error(`Error writing yaml file, error ${err}`);

    throw `writeYamlFile: ${fileName} ${err}`;
  }
}

function getPathClaim(kind: string, name: string, claimsPath: string) {
  return path.join(
    claimsPath,
    `${kind}s`.toLowerCase().replace('claim', ''),
    name.toLowerCase() + '.yaml',
  );
}

export function renameEntity(
  entity: any,
  catalogPath: string,
  oldname: string,
) {
  try {
    log.debug(`Renaming oldname ${oldname} in ${entity}`);

    const oldPath = getPath(entity.kind, oldname, catalogPath);

    const newPath = getPath(entity.kind, entity.metadata.name, catalogPath);

    fs.renameSync(oldPath, newPath);
  } catch (err) {
    log.error(`Error writing entity, error ${err}`);

    throw `renameEntity: ${entity.kind} ${err}`;
  }
}

export function removeEntity(entity: any, catalogPath: string) {
  try {
    log.debug(
      `Removing entity ${entity.kind}/${entity.metadata.name} in catalog ${catalogPath}`,
    );

    fs.rmSync(getPath(entity.kind, entity.metadata.name, catalogPath));
  } catch (err) {
    log.error(
      `Error removing entity ${entity.kind}/${entity.metadata.name} in catalog ${catalogPath}: ${err}`,
    );

    throw `removeEntity: ${entity.kind} ${err}`;
  }
}

export function removeFile(path: string) {
  fs.rmSync(path);
}

export function moveFile(oldPath: string, newPath: string) {
  //create new path getting the directory name

  const newDir = path.dirname(newPath);

  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir, { recursive: true });
  }

  fs.cpSync(oldPath, newPath);

  fs.rmSync(oldPath);
}

export function writeFunctionLog(functionName: string, logStream: string) {
  try {
    fs.writeFileSync(
      path.join('/tmp', `${functionName}.${randomString(5)}.log`),
      logStream + '\n',
    );
  } catch (err: any) {
    log.error(`Error writing log, error ${err}`);

    throw `writeLog: ${functionName} ${err}`;
  }
}

export function writeLogFile(fileName: string, logStream: string) {
  try {
    fs.appendFileSync(path.join('/tmp', fileName + '.log'), logStream + '\n');
  } catch (err: any) {
    log.error(`Error writing log, error ${err}`);

    throw `writeLog: ${fileName} ${err}`;
  }
}
