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

  // Original failure (e.g. the HTTP error a lookup helper rejected with),
  // preserved so the contextual message never hides the root cause
  cause?: unknown;

  constructor(refKey: string, message?: string, cause?: unknown) {
    super(message ?? `${refKey} could not be resolved`);

    this.name = 'ResolverError';

    this.refKey = refKey;

    this.cause = cause;
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

  // Expected absence (e.g. a dependency has not published its outputs yet):
  // stay quiet here. The failure boundary (resolveDep / the reconciliation
  // handler) logs the single contextual error, or the caller tolerates it.
  if (!secret) {
    log.debug(
      `The outputs secret '${secretName}' of '${crDependency.kind}/${crDependency.metadata.name}' was not found in namespace '${namespace}'.`,
    );
  }

  return secret;
}

/**
 * A ref or an already-loaded dep CR whose outputs must never be resolved:
 * ProviderConfig carries config, not published outputs.
 */
function isProviderConfigRef(candidate: any): boolean {
  return candidate?.kind === 'FirestartrProviderConfig';
}

function missingOutputsMessage(
  referring: string,
  namespace: string,
  cr: any,
): string {
  return `[operator] '${referring}' in namespace '${namespace}' depends on '${cr.kind}/${cr.metadata?.name}', but its outputs secret '${outputsSecretName(cr)}' was not found; aborting instead of provisioning with an incomplete dependency map`;
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

  // The outputs secret is only expected for deps whose outputs are consumed:
  // never for ProviderConfig, plain Kubernetes Secrets, or needsSecret: false
  const expectsSecret =
    resolve.needsSecret !== false &&
    (resolve.apiGroup === common.types.controller.FirestartrApiGroup ||
      resolve.apiGroup === common.types.controller.ExternalSecretsApiGroup) &&
    !isProviderConfigRef(resolve);

  const cached = deps[kr];

  if (cached) {
    // Reuse the already-loaded CR (its nested refs were walked on the first
    // visit), but never let an earlier needsSecret:false reference shield a
    // later one that does consume outputs: load and validate them now.
    if (!expectsSecret || cached.secret) return;

    if (isProviderConfigRef(cached.cr)) return;

    const secret = await resolveSecretRef(namespace, cached.cr, getSecret);

    if (!secret)
      throw new ResolverError(
        kr,
        missingOutputsMessage(referring, namespace, cached.cr),
      );

    cached.secret = secret;

    return;
  }

  let ref: any;

  try {
    ref = await getItemByItemPath(
      `${namespace}/${plural}/${resolve.name}`,
      resolve.apiGroup,
      resolve.apiVersion,
    );
  } catch (e: any) {
    // The production lookup (ctl.getItemByItemPath) rejects on 404, so a
    // missing dependency never reaches the guard below. Fail closed here with
    // the same contextual error instead of surfacing a bare HTTP failure.
    throw new ResolverError(
      kr,
      `[operator] '${referring}' in namespace '${namespace}' depends on '${resolve.kind}/${resolve.name}' but looking it up failed: ${e?.message ?? e}; aborting instead of provisioning with an incomplete dependency map`,
      e,
    );
  }

  if (!ref)
    throw new ResolverError(
      kr,
      `[operator] '${referring}' in namespace '${namespace}' depends on '${resolve.kind}/${resolve.name}' but it does not exist; aborting instead of provisioning with an incomplete dependency map`,
    );

  // Nested refs are only walked on the first visit: the cached branch above
  // reuses the CR already expanded into `references`.
  for (const nestedRef of walk(ref)) {
    references.push({ ref: nestedRef, referredBy: ref });
  }

  const secret = expectsSecret
    ? await resolveSecretRef(namespace, ref, getSecret)
    : undefined;

  if (!secret && expectsSecret)
    throw new ResolverError(
      kr,
      missingOutputsMessage(referring, namespace, ref),
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
