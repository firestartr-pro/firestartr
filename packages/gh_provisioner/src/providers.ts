import { Entity } from './entities';
import { ResolvedRef } from './refs';

import log from './logger';

const secretRegex = /\$\{\{ secrets\.(.*?) \}\}/g;

export function adaptProviders(entity: Entity) {
  const result: any = {};

  const { provider, secrets } = adaptProvider(entity.provider);

  result['providers'] = [provider];
  result['secrets'] = [].concat(secrets);

  return result;
}

export function adaptBackend(entity: Entity) {
  const backend: any = {};

  const entityBackend = entity.backend;

  const backendDependency = entityBackend.cr;

  const backendSecrets = getRefContextFromCr(entityBackend);

  const providerConfigData = replaceConfigSecrets(
    JSON.parse(backendDependency.spec.config),
    backendSecrets,
  );

  const providerInlineData = replaceInlineSecrets(
    backendDependency.spec.inline,
    backendSecrets,
  );

  backend[backendDependency.spec.type] = {};

  backend[backendDependency.spec.type]['config'] = providerConfigData;

  backend[backendDependency.spec.type]['inline'] = providerInlineData;

  return backend;
}

function adaptProvider(providerFromItem: ResolvedRef): any {
  const provider: any = {};

  const providerDependency = providerFromItem.cr;

  const providerSecrets = getRefContextFromCr(providerFromItem);

  const providerConfigData = replaceConfigSecrets(
    JSON.parse(providerDependency.spec.config),
    providerSecrets,
  );

  const providerInlineData = replaceInlineSecrets(
    providerDependency.spec.inline,
    providerSecrets,
  );

  provider['name'] = providerDependency.spec.type;

  provider['version'] = providerDependency.spec.version;

  provider['source'] = providerDependency.spec.source;

  provider['inline'] = providerInlineData;

  provider['config'] = providerConfigData;

  const secrets: any[] = [];

  if (providerDependency.spec.env) {
    const secretsEnv = JSON.parse(providerDependency.spec.env ?? {});

    for (const key of Object.keys(secretsEnv)) {
      secrets.push({
        key: key,

        value: secretsEnv[key],
      });
    }
  }

  return { provider, secrets };
}

function getRefContextFromCr(providerFromItem: ResolvedRef): any {
  const secrets: any = {};

  const cr = providerFromItem.cr;

  // check first there are any secrets to resolve
  if (cr.spec.secrets === undefined) return secrets;

  for (const i of Object.entries(cr.spec.secrets)) {
    const [objectKey, value]: [string, any] = i;

    const { key, name } = value.secretRef;

    const secret: any = Entity.refResolver({
      kind: 'Secret',
      name: name,
    });

    log.debug(
      `[${providerFromItem.getDepName()}] Resolving secret with key ${key} for ${name}`,
    );

    if (secret.cr.data[key] === undefined)
      throw new Error(`Secret ${name} does not contain key ${key}`);

    secrets[objectKey] = Buffer.from(secret.cr.data[key], 'base64').toString(
      'utf8',
    );
  }
  return secrets;
}

function replaceConfigSecrets(config: any, secrets: any) {
  for (const key in config) {
    if (typeof config[key] === 'object' && config[key] !== null) {
      // If the property is an object, call this function recursively
      replaceConfigSecrets(config[key], secrets);
    } else if (typeof config[key] === 'string') {
      // If the property is a string and its value is equal to secrets.something,
      // replace the value with the value of the 'something' key in the secrets object
      config[key] = config[key].replace(
        secretRegex,
        (_: any, group1: string) => {
          if (!secrets[group1]) {
            throw new Error(`Secret ${group1} not found in secrets`);
          }
          return secrets[group1];
        },
      );
    }
  }

  return config;
}

function replaceInlineSecrets(inline: string, secrets: any) {
  if (typeof inline !== 'string' || !inline) return inline;

  let result = inline;

  result = result.replace(secretRegex, (_: any, group1: string) => {
    if (!secrets[group1]) {
      throw new Error(`Secret ${group1} not found in secrets`);
    }
    return secrets[group1];
  });

  return result;
}
