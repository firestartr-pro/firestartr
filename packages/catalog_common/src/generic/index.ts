import { randomString, shuffleArray, shuffleObject } from './random';

import { annotateWithUUID, calculateStoregeKey, toMd5 } from './nomicon';

import CsvWriter from './csv_generator';

import { getLogger } from './logger';

import { sleep } from './time';

import { normalizeName, transformKeysToCamelCase } from './name';

import {
  getFirestartrAnnotation,
  getOwnerRepoPrNumberFromAnnotationValue,
  getPrLinkFromAnnotationValue,
} from './annotations';

import { getFirestartrLabel, normalizeLabel } from './labels';

import { removeRepeatedObjectsFromArrayByProp } from './arrays';
import { buildCommandExecutionError, normalizeExitCode } from './command_error';

export default {
  randomString,

  shuffleArray,

  shuffleObject,

  annotateWithUUID,

  calculateStoregeKey,

  CsvWriter,

  getLogger,

  sleep,

  normalizeName,

  transformKeysToCamelCase,

  getFirestartrAnnotation,

  getOwnerRepoPrNumberFromAnnotationValue,

  getPrLinkFromAnnotationValue,

  getFirestartrLabel,

  normalizeLabel,

  removeRepeatedObjectsFromArrayByProp,

  buildCommandExecutionError,

  normalizeExitCode,

  toMd5,
};
