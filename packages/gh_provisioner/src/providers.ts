import { Entity } from './entities';
import { ResolvedRef } from './refs';

import log from './logger';

const secretRegex = /\$\{\{ secrets\.(.*?) \}\}/g;

export function adaptProviders(entity: Entity) {
  const result: any = {};

  const { provider, secrets } = adaptProvider(entity, entity.provider);

  result['providers'] = [provider];
  result['secrets'] = [].concat(secrets);

  return result;
}

export function adaptBackend(entity: Entity) {
  const backend: any = {};

  const entityBackend = entity.backend;

  const backendDependency = entityBackend.cr;

  const backendSecrets = getRefContextFromCr(entity, entityBackend);

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

function adaptProvider(entity: Entity, providerFromItem: ResolvedRef): any {
  const provider: any = {};

  const providerDependency = providerFromItem.cr;

  const providerSecrets = getRefContextFromCr(entity, providerFromItem);

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

function getRefContextFromCr(
  entity: Entity,
  providerFromItem: ResolvedRef,
): any {
  const secrets: any = {};

  const cr = providerFromItem.cr;

  // check first there are any secrets to resolve
  if (cr.spec.secrets === undefined) return secrets;

  for (const i of Object.entries(cr.spec.secrets)) {
    const [objectKey, value]: [string, any] = i;

    const { key, name } = value.secretRef;

    const secret: any = entity.requireRef({
      kind: 'Secret',
      name: name,
    });

    log.debug(
      `[${providerFromItem.getDepName()}] Resolving secret with key ${key} for ${name}`,
    );

    const body: any = secret.cr;

    const data = body && body.data;

    // A Secret ref can resolve to a dep with no body, or to a body with no
    // `data` field: index it only once it is known to be there, so a bare
    // Secret cannot surface as a TypeError from the credential lookup below.
    if (!data || data[key] === undefined)
      throw new Error(
        `[gh-provisioner] ${entity.k8sId} could not resolve output '${key}' of Secret/${name} from its dependencies: the Secret has no such key`,
      );

    secrets[objectKey] = Buffer.from(data[key], 'base64').toString('utf8');
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
