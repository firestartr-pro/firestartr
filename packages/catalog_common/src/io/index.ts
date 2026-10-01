import { dumpYaml, getPath, fromYaml, toYaml } from './common';

import { cloneCatalog } from './clone_catalog';

import {
  moveFile,
  removeFile,
  writeClaim,
  writeEntity,
  writeFunctionLog,
  writeLogFile,
  writeYamlFile,
} from './write';

import { renameEntity, removeEntity } from './write';

import readEntity from './read';

import { listByKind, getFileListRecursively } from './read';

import { stripAnsi } from './strip_ansi';

export default {
  writeClaim,

  writeEntity,

  readEntity,

  listEntitiesByKind: listByKind,

  renameEntity,

  removeEntity,

  getEntityPath: getPath,

  cloneCatalog,

  dumpYaml,

  fromYaml,

  stripAnsi,

  toYaml,

  getFileListRecursively,

  writeLogFile,

  writeFunctionLog,

  writeYamlFile,

  removeFile,

  moveFile,
};
