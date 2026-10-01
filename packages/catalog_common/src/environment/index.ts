// Revocers the value from an environment variable
import { envVars } from '../types/envvars';

import log from '../logger';

export function getFromEnvironment(envVar: envVars): string | undefined {
  return process.env[envVar];
}

export function getFromEnvironmentWithDefault(
  envVar: envVars,
  defaultValue = '',
): string {
  return process.env[envVar] || defaultValue;
}

export function getFromEnvironmentAsBoolean(
  envVar: envVars,
): boolean | undefined {
  try {
    const envVariable: string = getFromEnvironmentWithDefault(envVar, '');
    return JSON.parse(envVariable.toLowerCase());
  } catch (e) {
    return undefined;
  }
}

export function checkExistOnEnvironment(envVar: envVars): boolean {
  const environmentValue = getFromEnvironment(envVar);
  log.debug(
    `Checking if environment variable ${envVar} exists: ${environmentValue}`,
  );
  if (!environmentValue || environmentValue === '') {
    return false;
  }

  return true;
}

export default {
  getFromEnvironment,
  getFromEnvironmentWithDefault,
  getFromEnvironmentAsBoolean,
  checkExistOnEnvironment,
};
