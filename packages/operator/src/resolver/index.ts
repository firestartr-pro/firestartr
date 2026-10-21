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

  constructor(refKey: string, message?: string) {
    super(message ?? `${refKey} could not be resolved`);

    this.name = 'ResolverError';

    this.refKey = refKey;
  }
}

/**
 * Name of the secret holding another CR's outputs (its terraform state
 * outputs, published through writeConnectionSecretToRef).
 */
export function outputsSecretName(crDependency: any): string {
  if (crDependency.kind === 'ExternalSecret') {
    return crDependency.metadata.name;
  }

  return `${crDependency['kind']}-${crDependency['metadata']['name']}-outputs`.toLowerCase();
}

export async function resolve(
  cr: any,
  getItemByItemPath: Function,
  getSecret: Function,
  namespace = 'default',
) {
  const deps: Dependencies = {};

  namespace = cr['metadata']['namespace'] || namespace;

  // Each pending entry knows which CR declared the ref, so failures can
  // report the referring item
  const pending: { ref: any; referredBy: any }[] = [...walk(cr)].map(
    (ref: any) => ({
      ref,
      referredBy: cr,
    }),
  );

  log.silly(
    `${cr.kind}/${cr.metadata?.name}: references ${JSON.stringify(
      pending.map((p) => p.ref),
      null,
      2,
    )}`,
  );

  // ⚠️ The pending list is mutated by resolveDep, adding new references if nested dependencies are found
  for (const pendingRef of pending) {
    await resolveDep(
      namespace,
      pendingRef,
      deps,
      pending,
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
  const secretName = outputsSecretName(crDependency);

  if (crDependency.kind === 'FirestartrProviderConfig') {
    log.debug(
      `The resolver is skipping secret resolution for '${crDependency.kind}/${crDependency.metadata.name}' of kind 'FirestartrProviderConfig' in namespace '${namespace}'.`,
    );
    return undefined;
  }

  const secret = await getSecret(namespace, secretName);

  if (!secret) {
    log.error(
      `The outputs secret '${secretName}' of '${crDependency.kind}/${crDependency.metadata.name}' was not found in namespace '${namespace}'.`,
    );
  }

  return secret;
}

async function resolveDep(
  namespace: string,
  pendingRef: { ref: any; referredBy: any },
  deps: Dependencies,
  references: { ref: any; referredBy: any }[],
  getItemByItemPath: Function,
  getSecret: Function,
) {
  const resolve = pendingRef.ref;

  const referredBy = pendingRef.referredBy;

  const referring = `${referredBy.kind}/${referredBy.metadata?.name}`;

  const plural = getPluralFromKind(resolve.kind);

  const kr = `${resolve.kind}-${resolve.name}`;

  if (kr in deps) return;

  const ref: any = await getItemByItemPath(
    `${namespace}/${plural}/${resolve.name}`,
    resolve.apiGroup,
    resolve.apiVersion,
  );

  if (!ref)
    throw new ResolverError(
      kr,
      `[operator] '${referring}' in namespace '${namespace}' depends on '${resolve.kind}/${resolve.name}' but it does not exist; aborting instead of provisioning with an incomplete dependency map`,
    );

  // We may have nested refs but they should not be circular
  // ⚠️ This mutates the references array, but it's ok because we don't need to resolve the same ref twice
  for (const nestedRef of walk(ref)) {
    references.push({ ref: nestedRef, referredBy: ref });
  }

  // The outputs secret is only expected for deps whose outputs are consumed:
  // never for ProviderConfig, plain Kubernetes Secrets, or needsSecret: false
  const expectsSecret =
    resolve.needsSecret !== false &&
    (resolve.apiGroup === common.types.controller.FirestartrApiGroup ||
      resolve.apiGroup === common.types.controller.ExternalSecretsApiGroup) &&
    ref.kind !== 'FirestartrProviderConfig';

  const secret = expectsSecret
    ? await resolveSecretRef(namespace, ref, getSecret)
    : undefined;

  if (!secret && expectsSecret)
    throw new ResolverError(
      kr,
      `[operator] '${referring}' in namespace '${namespace}' depends on '${ref.kind}/${ref.metadata?.name}', but its outputs secret '${outputsSecretName(ref)}' was not found; aborting instead of provisioning with an incomplete dependency map`,
    );

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
