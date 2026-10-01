import lodash from 'lodash';
import log from '../logger';

const { camelCase } = lodash;

export function normalizeName(name: string): string {
  log.debug(`Normalizing name ${name}`);
  return name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
}

export function transformKeysToCamelCase(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(transformKeysToCamelCase);
  }

  return Object.keys(obj).reduce((result, key) => {
    result[camelCase(key)] = transformKeysToCamelCase(obj[key]);
    return result;
  }, {} as any);
}
