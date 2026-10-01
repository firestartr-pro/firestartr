import * as client from '@kubernetes/client-node';
import github from 'github';
import { getPluralFromKind } from './definitions';
import common from 'catalog_common';
import * as k8s from '@kubernetes/client-node';
import {
  getPrInfoFromAnnotation,
  LAST_STATE_PR_ANNOTATION,
} from './pr-annotation';
import { getOperatorEnvSnapshot } from './operator-env';
import log from './logger';
import { getConnection as getCtlConnection } from './connection';
import { withApiReadSlot } from './utils/api-read-limiter';

const MAX_CHARS_OUPUT_PLAN = 20000;

function getOperatorProfile() {
  github.createProfile('operator', {
    type: 'snapshot',
    config: getOperatorEnvSnapshot(),
  });
  return github.withProfile('operator');
}

export async function getItem(kind: string, namespace: string, item: any) {
  const itemPath = `${namespace}/${kind}/${item.metadata.name}`;

  return await getItemByItemPath(itemPath);
}

async function fetchItemByItemPathResponse(
  itemPath: string,
  apiGroup: string = common.types.controller.FirestartrApiGroup,
  apiVersion = 'v1',
) {
  log.debug(`The ctl is getting the item at '${itemPath}'.`);

  const { kc, opts } = await getCtlConnection();

  opts.headers['Content-Type'] = 'application/json';

  opts.headers['Accept'] = 'application/json';

  const url =
    apiGroup === common.types.controller.KubernetesApiGroup
      ? `${getServerUrl(kc)}/api/v1/namespaces/${itemPath}`
      : `${getServerUrl(kc)}/apis/${apiGroup}/${apiVersion}/namespaces/${itemPath}`;

  log.silly(`Sending request ${url}`);

  return await fetch(url, { method: 'get', headers: opts.headers });
}

export async function getItemByItemPath(
  itemPath: string,
  apiGroup: string = common.types.controller.FirestartrApiGroup,
  apiVersion = 'v1',
) {
  return await withApiReadSlot(async () => {
    try {
      const r = await fetchItemByItemPathResponse(
        itemPath,
        apiGroup,
        apiVersion,
      );

      if (!r.ok) {
        const err = new Error(
          `Error on getItemByItemPath: ${itemPath}: ${r.statusText}`,
        );

        log.warn(`Error on getItemByItemPath: ${itemPath}: ${r.statusText}`);

        throw err;
      }

      return await r.json();
    } catch (e: any) {
      log.warn(
        `Error on getItemByItemPath: ${e instanceof Error ? e.stack || e.message : JSON.stringify(e)}`,
      );

      throw e;
    }
  });
}

/**
 * Like getItemByItemPath but returns null when the resource is not found
 * (404) or there is a conflict (409), without logging those as errors.
 * Use this when a missing resource is an expected condition (e.g. checking
 * whether a parent CR has been provisioned before its children arrive).
 */
export async function getItemByItemPathOrNull(
  itemPath: string,
  apiGroup: string = common.types.controller.FirestartrApiGroup,
  apiVersion = 'v1',
): Promise<any | null> {
  return await withApiReadSlot(async () => {
    try {
      const r = await fetchItemByItemPathResponse(
        itemPath,
        apiGroup,
        apiVersion,
      );

      if (r.status === 404 || r.status === 409) {
        log.debug(
          `Item at '${itemPath}' returned ${r.status} (expected), returning null.`,
        );
        return null;
      }

      if (!r.ok) {
        const err = new Error(
          `Error on getItemByItemPathOrNull: ${itemPath}: ${r.statusText}`,
        );

        log.warn(
          `Error on getItemByItemPathOrNull: ${itemPath}: ${r.statusText}`,
        );

        throw err;
      }

      return await r.json();
    } catch (e: any) {
      log.warn(
        `Error on getItemByItemPathOrNull: ${e instanceof Error ? e.stack || e.message : JSON.stringify(e)}`,
      );

      throw e;
    }
  });
}

async function writeManifest(
  kind: string,
  namespace: string,
  item: any,
  apiSlug: string,
) {
  const { kc, opts } = await getCtlConnection();

  opts.headers['Content-Type'] = 'application/json';

  opts.headers['Accept'] = 'application/json';

  const r = await fetch(
    `${getServerUrl(kc)}/${apiSlug}`,

    {
      method: 'PUT',

      headers: opts.headers,

      body: JSON.stringify(item),
    },
  );

  if (!r.ok) {
    throw `${r.statusText}`;
  }

  const jsonResponse = await r.json();

  return jsonResponse;
}

export function writeSecret(secret: any, namespace: any) {
  log.debug(
    `The ctl is writing the secret '${secret.metadata.name}' in namespace '${namespace}'.`,
  );

  return writeManifest(
    'secrets',

    namespace,

    secret,

    `api/v1/namespaces/${namespace}/secrets/${secret.metadata.name}`,
  );
}

export async function writeStatus(kind: string, namespace: string, item: any) {
  log.debug(
    `The ctl is writing the status for item '${item.kind}/${item.metadata.name}' in namespace '${item.metadata.namespace}'.`,
  );

  return await writeManifest(
    kind,

    namespace,

    item,

    `apis/firestartr.dev/v1/namespaces/${namespace}/${kind}/${item.metadata.name}/status`,
  );
}

export function writeFinalizer(kind: string, namespace: string, item: any) {
  log.debug(
    `The ctl is writing the status for item '${item.kind}/${item.metadata.name}' in namespace '${item.metadata.namespace}'.`,
  );

  return writeManifest(
    kind,

    namespace,

    item,

    `apis/firestartr.dev/v1/namespaces/${namespace}/${kind}/${item.metadata.name}/metadata/finalizers`,
  );
}

export async function listItems(
  kind: string,
  namespace: string,
  kc: any,
  opts: any,
): Promise<Array<any>> {
  try {
    const r = await fetch(
      `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/${kind}`,

      {
        headers: opts.headers,

        method: 'GET',
      },
    );

    if (!r.ok) {
      throw `Error on listItems ${kind}: ${r.statusText}`;
    }

    return await r.json();
  } catch (err) {
    log.error(`On listItems: ${err}`);

    throw err;
  }
}

export async function* observeList(
  kind: string,
  namespace: string,
  revision: string,
  kc: any,
  opts: any,
) {
  const response: any = await fetch(
    `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/${kind}?watch=1&resourceVersion=${revision}`,

    {
      headers: {
        ...opts.headers,

        'Transfer-Enconding': 'chunked',
      },

      method: 'GET',
    },
  );

  try {
    let chunks = '';

    for await (const chunk of response.body) {
      common.io.writeLogFile('chunk_file_' + kind, `Log chunk: ${chunks}`);

      const buffer = Buffer.from(chunk);

      const chunkString = buffer.toString('utf-8');

      chunks += chunkString;

      if (helperIsValidJSON(chunks)) {
        yield JSON.parse(chunks);

        chunks = '';
      }
    }
  } catch (err: any) {
    if (err instanceof TypeError) {
      log.error(
        `The ctl encountered an error while listing chunks for '${kind}' with revision '${revision}' in namespace '${namespace}': '${err}'.`,
      );
    } else {
      log.error(
        `The ctl encountered an unknown error while listing chunks for '${kind}' with revision '${revision}' in namespace '${namespace}': '${err}'.`,
      );
    }
  }
}

function helperIsValidJSON(part: string) {
  try {
    JSON.parse(part);

    return true;
  } catch (err: any) {
    common.io.writeLogFile('helperIsValidJSON', `Error parsing JSON: ${err}`);

    return false;
  }
}

export { getConnection } from './connection';
export {
  getCurrentConcurrentApiCalls,
  getPendingApiCalls,
  getPeakConcurrentApiCalls,
} from './utils/api-read-limiter';

export function getServerUrl(kc: client.KubeConfig): string {
  const currentContext = kc.currentContext;
  const context =
    kc.contexts.find((c) => c.name === currentContext) ?? kc.contexts[0];
  const clusterName = context?.cluster;
  const cluster =
    kc.clusters.find((c) => c.name === clusterName) ?? kc.clusters[0];
  if (!cluster?.server) {
    throw new Error(
      `No cluster server found in KubeConfig (context=${currentContext || '<none>'})`,
    );
  }
  return cluster.server;
}

function buildTFResultStatusUpdate(
  namespace: string,
  tfResultName: string,
  resourceVersion: string,
  exitCode: number,
  retryCount?: number,
) {
  const status: any = {
    exitCode: exitCode,
    lastUpdateTime: new Date().toISOString(),
  };

  if (retryCount !== undefined) {
    status.retryCount = retryCount;
  }

  return {
    apiVersion: 'firestartr.dev/v1',
    kind: 'TFResult',
    metadata: {
      name: tfResultName,
      namespace: namespace,
      resourceVersion: resourceVersion,
    },
    status,
  };
}

async function tryWriteTFResultStatus(
  namespace: string,
  tfResultName: string,
  resourceVersion: string,
  exitCode: number,
  retryCount?: number,
) {
  const statusUpdate = buildTFResultStatusUpdate(
    namespace,
    tfResultName,
    resourceVersion,
    exitCode,
    retryCount,
  );

  try {
    await writeStatus('tfresults', namespace, statusUpdate);
  } catch (err: any) {
    if (err === 'Not Found' || err?.message === 'Not Found') {
      log.warn(
        `TFResult status subresource unavailable; keeping result in spec only. TFResult/${tfResultName}`,
      );

      return;
    }

    throw err;
  }
}

export async function upsertResult(
  namespace: string,
  item: any,
  result: string,
  exitCode = 0,
  existingRetryCount?: number,
) {
  const { kc, opts } = await getCtlConnection();

  kc.makeApiClient(client.CoreV1Api);

  const exists: any = await getTFResult(namespace, item);

  const currentRetryCount =
    existingRetryCount !== undefined
      ? existingRetryCount
      : (exists?.status?.retryCount ?? 0);

  const newRetryCount = exitCode === 0 ? 0 : currentRetryCount + 1;

  const tfResultName = `${item.kind}-${item.metadata.name}`.toLowerCase();

  if (exists) {
    // Update the spec
    exists.spec.result = result.toString();

    const updated = await writeManifest(
      'tfresults',
      namespace,
      exists,
      `apis/firestartr.dev/v1/namespaces/${namespace}/tfresults/${tfResultName}`,
    );

    // Update status subresource separately using the resourceVersion from the
    // updated object to avoid a 409 conflict caused by the PUT above incrementing it.
    await tryWriteTFResultStatus(
      namespace,
      tfResultName,
      updated.metadata.resourceVersion,
      exitCode,
      newRetryCount,
    );

    updated.status = updated.status || {};
    updated.status.retryCount = newRetryCount;

    return updated;
  } else {
    // Create new TFResult
    const url = `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/tfresults`;

    opts.headers['Content-Type'] = 'application/json';

    opts.headers['Accept'] = '*';

    const resultObject: any = {
      apiVersion: 'firestartr.dev/v1',

      kind: 'TFResult',

      metadata: {
        name: tfResultName,
      },

      spec: {
        result: result.toString(),

        reference: {
          refKind: item.kind,

          refName: item.metadata.name,
        },
      },
    };

    const r = await fetch(
      url,

      {
        method: 'POST',

        headers: opts.headers,

        body: JSON.stringify(resultObject),
      },
    );

    if (r.status === 409) {
      log.debug(`TFResult '${tfResultName}' already exists (409), updating.`);

      const existingUrl = `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/tfresults/${tfResultName}`;
      const getResp = await fetch(existingUrl, { ...opts, method: 'GET' });

      if (!getResp.ok) {
        throw `TFResult: failed to fetch existing '${tfResultName}': ${getResp.statusText}`;
      }

      const existing = await getResp.json();

      existing.spec.result = result.toString();

      const updated = await writeManifest(
        'tfresults',
        namespace,
        existing,
        `apis/firestartr.dev/v1/namespaces/${namespace}/tfresults/${tfResultName}`,
      );

      await tryWriteTFResultStatus(
        namespace,
        tfResultName,
        updated.metadata.resourceVersion,
        exitCode,
        newRetryCount,
      );

      updated.status = updated.status || {};
      updated.status.retryCount = newRetryCount;

      return updated;
    }

    if (!r.ok) {
      throw `TFResult: ${r.statusText}`;
    }

    const created = await r.json();

    // Update status subresource for the newly created resource.
    await tryWriteTFResultStatus(
      namespace,
      tfResultName,
      created.metadata.resourceVersion,
      exitCode,
      newRetryCount,
    );

    created.status = created.status || {};
    created.status.retryCount = newRetryCount;

    return created;
  }
}

export async function deleteSecret(secretName: string, namespace: string) {
  const { kc } = await getCtlConnection();
  const k8sApi = kc.makeApiClient(client.CoreV1Api);

  try {
    await k8sApi.deleteNamespacedSecret({ name: secretName, namespace });
  } catch (e: any) {
    if (e && e.code === 404) {
      log.error(
        `The ctl failed to delete the secret '${secretName}' in namespace '${namespace}' because it was not found.`,
      );
      return null;
    } else {
      throw e;
    }
  }
}

export async function upsertSecret(namespace: string, secret: any) {
  const { kc } = await getCtlConnection();

  const k8sApi = kc.makeApiClient(client.CoreV1Api);

  secret.metadata.name = secret.metadata.name.toLowerCase();

  try {
    await k8sApi.readNamespacedSecret({
      name: secret.metadata.name,
      namespace,
    });

    await k8sApi.replaceNamespacedSecret({
      name: secret.metadata.name,
      namespace,
      body: secret,
    });
  } catch (e: any) {
    if (e.code === 404 || e.statusCode === 404) {
      await k8sApi.createNamespacedSecret({ namespace, body: secret });
    } else {
      throw e;
    }
  }
}

export async function getSecret(namespace: string, secretName: string) {
  const { kc } = await getCtlConnection();

  const k8sApi = kc.makeApiClient(client.CoreV1Api);

  try {
    const secret = await k8sApi.readNamespacedSecret({
      name: secretName,
      namespace,
    });

    return secret;
  } catch (e: any) {
    if (e.code === 404 || e.statusCode === 404) {
      log.error(
        `The ctl could not find the secret '${secretName}' in namespace '${namespace}'.`,
      );
      return null;
    } else {
      throw e;
    }
  }
}

export async function getTFResult(namespace: string, item: any) {
  const { kc, opts } = await getCtlConnection();

  opts.headers['Content-Type'] = 'application/json';

  opts.headers['Accept'] = 'application/json';

  const r = await fetch(
    `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/tfresults/${item.kind}-${item.metadata.name}`.toLowerCase(),

    {
      method: 'get',

      headers: opts.headers,
    },
  );

  if (!r.ok) {
    if (r.status === 404) {
      return null;
    }
    throw `Error on getItem: TFResult/${item['metadata']['name']}: ${r.statusText}`;
  }

  return r.json();
}

/**
 * Check if the item has been renamed, by searching items of the
 * same kind with the name specified in the label "firestartr.dev/old-name"
 * @param {string} namespace - Namespace to use
 * @param {any} item - Object to check if has been renamed
 */
export async function checkIfRenamed(
  namespace: string,
  item: any,
): Promise<boolean> {
  log.debug(
    `The ctl is checking if item '${item.kind}/${item.metadata.name}' in namespace '${namespace}' has been renamed.`,
  );

  const oldName =
    item.metadata?.labels?.[common.types.controller.FirestartrLabelOldName];

  // If the item does not have firestartr.dev/old-name label, it has not been renamed
  if (!oldName) return false;

  try {
    // Check that the old item still exists
    const plural = getPluralFromKind(item.kind);

    const { kc, opts } = await getCtlConnection();

    const url = `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/${plural}/${item.metadata.name}`;

    const r = await fetch(
      url,

      {
        method: 'GET',

        headers: opts.headers,
      },
    );

    if (!r.ok) {
      if (r.status === 404) {
        log.debug(
          `The ctl is checking for a rename of item '${item.kind}/${item.metadata.name}' in namespace '${namespace}', but the old item name was not found.`,
        );
        return false;
      }
    }

    await r.json();

    return true;
  } catch (err) {
    log.debug(err);

    return false;
  }
}

export async function upsertFinalizer(
  kind: string,
  namespace: string,
  item: any,
  finalizer: string,
) {
  const { kc, opts } = await getCtlConnection();

  const url = `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/${kind}/${item.metadata.name}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    // Fresh GET to get current finalizers and resourceVersion
    const getResp = await fetch(url, {
      method: 'GET',
      headers: { ...opts.headers, Accept: 'application/json' },
    });
    if (!getResp.ok) {
      throw `Error fetching item for finalizer upsert: ${namespace}/${kind}/${item.metadata.name}: ${getResp.statusText}`;
    }
    const currentItem = await getResp.json();
    const currentFinalizers: string[] = currentItem.metadata.finalizers || [];

    if (currentFinalizers.includes(finalizer)) {
      log.debug(
        `The ctl tried to upsert the finalizer '${finalizer}' for '${kind}/${item.metadata.name}' in namespace '${namespace}', but it was already set.`,
      );
      return;
    }

    log.debug(
      `The ctl is setting the finalizer '${finalizer}' for '${kind}/${item.metadata.name}' in namespace '${namespace}' (attempt ${attempt + 1}).`,
    );

    const newFinalizers = [...currentFinalizers, finalizer];
    const body = JSON.stringify([
      {
        op: 'add',
        path: '/metadata/finalizers',
        value: newFinalizers,
      },
    ]);

    const patchResp = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...opts.headers,
        'Content-Type': 'application/json-patch+json',
        Accept: '*',
        'If-Match': currentItem.metadata.resourceVersion,
      },
      body,
    });

    if (patchResp.ok) {
      return patchResp.json();
    }

    if (patchResp.status === 409) {
      log.debug(
        `Conflict upserting finalizer '${finalizer}' for '${kind}/${item.metadata.name}' (attempt ${attempt + 1}), retrying.`,
      );
      continue;
    }

    throw `Error on upsertFinalizer: ${namespace}/${kind}/${item.metadata.name}: ${patchResp.statusText}`;
  }

  throw `Failed to upsert finalizer '${finalizer}' for '${namespace}/${kind}/${item.metadata.name}' after 5 attempts.`;
}

/**
 * Remove the given finalizer
 * @param {string} kind - Kind of the item
 * @param {string} namespace - Namespace of the item
 * @param {any | string} item - Item to remove the finalizer or the name of the item
 * @param finalizer - Finalizer to remove
 * @returns {void}
 */
export async function unsetFinalizer(
  kind: string,
  namespace: string,
  item: any | string,
  finalizer: string,
) {
  const { kc, opts } = await getCtlConnection();

  let itemObj: any;
  if (typeof item === 'string') {
    itemObj = await getItemByItemPath([namespace, kind, item].join('/'));
  } else {
    itemObj = item;
  }

  const name = itemObj.metadata.name;
  const url = `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/${kind}/${name}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    // Fresh GET to get current finalizers and resourceVersion
    const getResp = await fetch(url, {
      method: 'GET',
      headers: { ...opts.headers, Accept: 'application/json' },
    });
    if (!getResp.ok) {
      throw `Error fetching item for finalizer unset: ${namespace}/${kind}/${name}: ${getResp.statusText}`;
    }
    const currentItem = await getResp.json();
    const currentFinalizers: string[] = currentItem.metadata.finalizers || [];

    if (!currentFinalizers.includes(finalizer)) {
      log.debug(
        `The ctl tried to unset the finalizer '${finalizer}' for '${kind}/${name}' in namespace '${namespace}', but it was not present.`,
      );
      return;
    }

    log.debug(
      `The ctl is removing the finalizer '${finalizer}' from '${kind}/${name}' in namespace '${namespace}' (attempt ${attempt + 1}).`,
    );

    const newFinalizers = currentFinalizers.filter(
      (f: string) => f !== finalizer,
    );
    const body = JSON.stringify([
      {
        op: 'replace',
        path: '/metadata/finalizers',
        value: newFinalizers,
      },
    ]);

    const patchResp = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...opts.headers,
        'Content-Type': 'application/json-patch+json',
        Accept: '*',
        'If-Match': currentItem.metadata.resourceVersion,
      },
      body,
    });

    if (patchResp.ok) {
      return patchResp.json();
    }

    if (patchResp.status === 409) {
      log.debug(
        `Conflict unsetting finalizer '${finalizer}' for '${kind}/${name}' (attempt ${attempt + 1}), retrying.`,
      );
      continue;
    }

    throw `Error on unsetFinalizer: ${namespace}/${kind}/${name}: ${patchResp.statusText}`;
  }

  throw `Failed to unset finalizer '${finalizer}' for '${namespace}/${kind}/${name}' after 5 attempts.`;
}

/**
 * @deprecated Misspelled export kept for backward compatibility.
 * Use {@link writeTerraformOutputInTFResult} instead.
 */
export function writeTerraformOuputInTFResult(
  item: any,
  output: string,
  exitCode?: number,
) {
  const resolvedExitCode =
    exitCode !== undefined ? exitCode : /\berror\b/i.test(output) ? 1 : 0;

  return upsertResult(item.metadata.namespace, item, output, resolvedExitCode);
}

/** Correctly-spelled canonical export. Use this instead of the deprecated {@link writeTerraformOuputInTFResult}. */
export const writeTerraformOutputInTFResult = writeTerraformOuputInTFResult;

export function writeConnectionSecret(
  item: any,
  outputsConnection: any,
  finalize = false,
) {
  const data: any = {};

  for (const key of Object.keys(outputsConnection)) {
    data[key] = Buffer.from(
      outputsConnection[key]['value'].toString(),
    ).toString('base64');
  }

  const secret = {
    apiVersion: 'v1',

    kind: 'Secret',

    metadata: {
      name: `${item.kind}-${item.metadata.name}-outputs`,

      namespace: item.metadata.namespace,

      finalizers: finalize ? ['firestartr.dev/finalizer'] : [],

      ownerReferences: [
        {
          apiVersion: item.apiVersion,

          kind: item.kind,

          name: item.metadata.name,

          uid: item.metadata.uid,

          controller: true,

          blockOwnerDeletion: true,
        },
      ],
    },

    data: data,
  };

  return upsertSecret(item.metadata.namespace, secret);
}

export async function writePlanInGithubPR(prUrl: string, planText: string) {
  try {
    const url_parameters: string[] = prUrl.split('/');

    const pr_number: string = url_parameters[url_parameters.length - 1];

    const repo: string = url_parameters[url_parameters.length - 3];

    const owner: string = url_parameters[url_parameters.length - 4];

    const message = `# TERRAFORM PLAN 🚀
    \`\`\`shell
    ${planText}
    \`\`\`
    `;
    await getOperatorProfile().pulls.commentInPR(
      message,
      +pr_number,
      repo,
      owner,
      'terraform:plan',
    );
  } catch (err) {
    log.error(`writePlanInGithubPR: Cannot write plan in PR: ${err}`);
  }
}

export async function addApplyCommitStatus(
  cr: any,
  state: 'error' | 'failure' | 'pending' | 'success',
  targetURL = '',
  description = '',
  context = '',
) {
  try {
    await addCommitStatusToPrMergeCommit(
      cr.metadata.annotations['firestartr.dev/last-state-pr'],
      state,
      targetURL,
      description,
      context,
    );
  } catch (e: any) {
    log.error(
      `The ctl encountered an error while adding commit status for custom resource '${cr.metadata.name}' in namespace '${cr.metadata.namespace}'. State: '${state}'. Target URL: '${targetURL}'. Description: '${description}'. Error: '${e}'.`,
    );
  }
}

export async function addDestroyCommitStatus(
  cr: any,
  state: 'error' | 'failure' | 'pending' | 'success',
  description = '',
  context = '',
) {
  try {
    const prInfo = getPrInfoFromAnnotation(cr, LAST_STATE_PR_ANNOTATION);

    if (!prInfo) return;

    await addCommitStatusToPrMergeCommit(
      prInfo.annotationValue,
      state,
      '',
      description,
      context,
    );
  } catch (e: any) {
    log.error(
      `The ctl encountered an error while adding the destroy commit status for custom resource '${cr.metadata.name}' in namespace '${cr.metadata.namespace}'. State: '${state}'. Description: '${description}'. Error: '${e}'.`,
    );
  }
}

export async function addPlanStatusCheck(
  prUrl: string,
  summary: string,
  status = 'in_progress',
  isFailure = false,
) {
  try {
    log.debug(
      `The ctl is checking the length of the plan summary, which is '${summary.length}'.`,
    );

    // Determine if we should wrap in fences
    const shouldWrap = status === 'completed' && !summary.includes('```');
    const FENCE_OVERHEAD = 17; // "```terraform\n" + "\n```"

    let processedSummary = summary;

    if (shouldWrap) {
      // Truncate accounting for fence overhead
      const maxBodyLength = MAX_CHARS_OUPUT_PLAN - FENCE_OVERHEAD;
      if (summary.length > maxBodyLength) {
        const mustDrop = summary.length - maxBodyLength;
        processedSummary = summary.substring(mustDrop);
        log.debug(
          `The ctl found the plan summary too lengthy (length: '${summary.length}'). The summary must drop because '${mustDrop}'.`,
        );
      }
      // Wrap in fences
      processedSummary = `\`\`\`terraform\n${processedSummary}\n\`\`\``;
    } else if (summary.length > MAX_CHARS_OUPUT_PLAN) {
      // Truncate without wrapping
      const mustDrop = summary.length - MAX_CHARS_OUPUT_PLAN;
      processedSummary = summary.substring(mustDrop);
      log.debug(
        `The ctl found the plan summary too lengthy (length: '${summary.length}'). The summary must drop because '${mustDrop}'.`,
      );
    }

    await addStatusCheck(
      { summary: processedSummary, title: 'Terraform Plan Results' },
      isFailure,
      'terraform_plan',
      prUrl,
      status,
    );
  } catch (e: any) {
    log.error(
      `The ctl encountered an error while adding plan status for PR '${prUrl}' with status '${status}'. Is Failure: '${isFailure}'. Error: '${e}'.`,
    );
  }
}

async function addStatusCheck(
  output: any,
  isFailure: boolean,
  name: string,
  prAnnotationValue: string,
  status: string,
) {
  const { owner, repo, prNumber } =
    common.generic.getOwnerRepoPrNumberFromAnnotationValue(prAnnotationValue);

  const branchSha: string = await getOperatorProfile().pulls.getPrLastCommitSHA(
    prNumber,
    repo,
    owner,
  );

  log.info(
    `The ctl is adding a status check for '${owner}/${repo}' on branch '${branchSha}' with PR annotation value '${prAnnotationValue}' and name '${name}'.`,
  );

  await getOperatorProfile().repo.addStatusCheck(
    output,
    isFailure,
    branchSha,
    name,
    status,
    repo,
    owner,
  );
}

async function addCommitStatusToPrMergeCommit(
  prAnnotationValue: string,
  state: 'error' | 'failure' | 'pending' | 'success',
  targetURL: string,
  description: string,
  context: string,
) {
  const { owner, repo, prNumber } =
    common.generic.getOwnerRepoPrNumberFromAnnotationValue(prAnnotationValue);

  const branchSha: string =
    await getOperatorProfile().pulls.getPrMergeCommitSHA(prNumber, repo, owner);

  log.info(
    `The ctl is adding a commit status for '${owner}/${repo}' on branch '${branchSha}'. State: '${state}'. Target URL: '${targetURL}'.`,
  );

  await getOperatorProfile().repo.addCommitStatus(
    state,
    branchSha,
    repo,
    owner,
    targetURL,
    description,
    context,
  );
}

export async function createDryRun(manifest: any, namespace: string) {
  const { kc } = await getCtlConnection();

  const k8sApi: client.CustomObjectsApi = kc.makeApiClient(
    k8s.CustomObjectsApi,
  );

  const plural = getPluralFromKind(manifest.kind);

  if (!plural) throw new Error(`Could not get plural for ${manifest.kind}`);

  await k8sApi.createNamespacedCustomObject({
    group: 'firestartr.dev',
    version: 'v1',
    namespace,
    plural,
    body: manifest,
    dryRun: 'All',
  });
}

export async function updateDryRun(manifest: any, namespace: string) {
  const { kc } = await getCtlConnection();

  const k8sApi: client.CustomObjectsApi = kc.makeApiClient(
    k8s.CustomObjectsApi,
  );

  const plural = getPluralFromKind(manifest.kind);

  if (!plural) throw new Error(`Could not get plural for ${manifest.kind}`);

  await k8sApi.replaceNamespacedCustomObject({
    group: 'firestartr.dev',
    version: 'v1',
    namespace,
    plural,
    name: manifest.metadata.name,
    body: manifest,
    dryRun: 'All',
  });
}
