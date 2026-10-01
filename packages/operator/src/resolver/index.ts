import { getPluralFromKind } from '../definitions';
import common from 'catalog_common';

import log from '../logger';

type Dependency = {
  cr: any;

  secret: any;
};

export type Dependencies = { [key: string]: Dependency };

export class ResolverError extends Error {
  refKey: string;

  constructor(refKey: string) {
    super(`${refKey} could not be resolved`);
    this.name = 'ResolverError';
    this.refKey = refKey;
  }
}

export async function resolve(
  cr: any,
  getItemByItemPath: Function,
  getSecret: Function,
  namespace = 'default',
) {
  const deps: Dependencies = {};

  namespace = cr['metadata']['namespace'] || namespace;

  const references = [...walk(cr)];

  log.silly(
    `${cr.kind}/${cr.metadata?.name}: references ${JSON.stringify(references, null, 2)}`,
  );

  // ⚠️ The references array is mutated by resolveDep, adding new references if nested dependencies are found
  for (const resolve of references) {
    await resolveDep(
      namespace,
      resolve,
      deps,
      references,
      getItemByItemPath,
      getSecret,
    );
  }

  return deps;
}

export async function resolveSecretRef(
  namespace: string,
  crDependency: any,
  getSecret: Function,
) {
  let secretName =
    `${crDependency['kind']}-${crDependency['metadata']['name']}-outputs`.toLowerCase();

  if (crDependency.kind === 'FirestartrProviderConfig') {
    log.debug(
      `The resolver is skipping secret resolution for '${crDependency.kind}/${crDependency.metadata.name}' of kind 'FirestartrProviderConfig' in namespace '${namespace}'.`,
    );
    return undefined;
  }

  if (crDependency.kind === 'ExternalSecret') {
    secretName = crDependency.metadata.name;
  }

  const secret = await getSecret(namespace, secretName);

  if (!secret) {
    log.error(
      `The resolver could not find the secret '${secretName}' required by custom resource dependency '${crDependency}' in namespace '${namespace}'.`,
    );
    console.error(`Could not resolve secret ${secretName}`);
  }

  return secret;
}

async function resolveDep(
  namespace: string,
  resolve: any,
  deps: Dependencies,
  references: any,
  getItemByItemPath: Function,
  getSecret: Function,
) {
  const plural = getPluralFromKind(resolve.kind);

  const kr = `${resolve.kind}-${resolve.name}`;

  if (kr in deps) return;

  const ref: any = await getItemByItemPath(
    `${namespace}/${plural}/${resolve.name}`,
    resolve.apiGroup,
    resolve.apiVersion,
  );

  if (!ref) throw new ResolverError(kr);

  // We may have nested refs but they should not be circular
  // ⚠️ This mutates the references array, but it's ok because we don't need to resolve the same ref twice
  for (const nestedRef of walk(ref)) {
    references.push(nestedRef);
  }

  const secret =
    resolve.needsSecret !== false &&
    (resolve.apiGroup === common.types.controller.FirestartrApiGroup ||
      resolve.apiGroup === common.types.controller.ExternalSecretsApiGroup)
      ? await resolveSecretRef(namespace, ref, getSecret)
      : undefined;

  deps[kr] = {
    cr: ref,

    secret: secret,
  };
}

function* walk(item: any) {
  const toResolve: any[] = walkItem(item);

  for (const resolve of toResolve) {
    yield resolve;
  }
}

function walkItem(item: any): any[] {
  if (Array.isArray(item)) return walkArray(item);
  else if (item.constructor === Object) return walkObject(item);
  else return [];
}

function walkArray(items: any): any[] {
  const toResolve: any[] = [];

  for (const itemN of items) {
    toResolve.push(walkItem(itemN));
  }

  return toResolve.flat(Infinity);
}

function walkObject(item: any): any[] {
  const toResolve = [];

  // For now we only support refs to secrets.
  // We cannot make it generic because of WriteSecretConnectionToRef in our CRDs
  const refKeyRegex = /^(secret)Ref$/;

  for (const key in item) {
    if (key === 'ref') {
      if (item[key].kind === 'ExternalSecret') {
        toResolve.push({
          ...item[key],
          apiGroup: common.types.controller.ExternalSecretsApiGroup,
          apiVersion: 'v1beta1',
        });
      } else if (item[key].kind === 'Secret') {
        toResolve.push({
          ...item[key],
          apiGroup: common.types.controller.KubernetesApiGroup,
          apiVersion: 'v1',
        });
      } else {
        toResolve.push({
          ...item[key],
          apiGroup: common.types.controller.FirestartrApiGroup,
          apiVersion: 'v1',
        });
      }
    } else if (refKeyRegex.test(key)) {
      const match = key.match(refKeyRegex);

      if (!match) throw new Error(`Could not parse ref key ${key}`);

      // get the first capture group from the regex and lowercase it because should be in camel case
      const refSingular = match[1];

      const refKind = `${refSingular[0].toUpperCase()}${refSingular.slice(1)}`;

      const ref = {
        ...item[key],
        apiVersion: 'v1',
        apiGroup: common.types.controller.KubernetesApiGroup,
        kind: refKind,
      };

      toResolve.push(ref);
    } else {
      toResolve.push(walkItem(item[key]));
    }
  }

  return toResolve.flat(Infinity);
}
