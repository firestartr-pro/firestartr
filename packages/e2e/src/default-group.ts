import common from 'catalog_common';
import {
  CLAIM_KIND_TO_CR_KIND,
  FIRESTARTR_API_VERSION,
} from './claim-taxonomy';
import { destroyOrgResources } from './cleanup/org-resources';
import { createNameBuilder } from './names';
import { WAIT_FOR_CR_TIMEOUT_SECONDS } from './test-constants';
import type { E2EApi, JsonPatchOperation } from './types';

const DEFAULT_GROUP_SUFFIX = 'default-group';
const CLAIM_REF_ANNOTATION =
  common.generic.getFirestartrAnnotation('claim-ref');

export type DefaultGroup = {
  name: string;
  ref: `group:${string}`;
  tfStateKey: string;
};

function buildGroupClaimPatches(name: string): JsonPatchOperation[] {
  return [
    { op: 'replace', path: '/name', value: name },
    { op: 'replace', path: '/providers/github/name', value: name },
    { op: 'replace', path: '/members', value: [] },
  ];
}

async function cleanupExistingDefaultGroup(
  client: E2EApi,
  name: string,
): Promise<void> {
  await client.k8s.deleteCustomResourcesByAnnotation({
    kind: CLAIM_KIND_TO_CR_KIND['GroupClaim'],
    apiVersion: FIRESTARTR_API_VERSION,
    annotationKey: CLAIM_REF_ANNOTATION,
    annotationValues: [`GroupClaim/${name}`],
    timeout: WAIT_FOR_CR_TIMEOUT_SECONDS,
    forceFinalizers: true,
  });
  await destroyOrgResources(client, [name]);
}

export async function ensureDefaultGroup(
  client: E2EApi,
): Promise<DefaultGroup> {
  const name = createNameBuilder(client.getPrefix()).build(
    DEFAULT_GROUP_SUFFIX,
  );

  await cleanupExistingDefaultGroup(client, name);

  const renderedGroup = await client.claims.renderLocally('firestartr', {
    patches: buildGroupClaimPatches(name),
  });

  const primaryCrPath = renderedGroup.crPaths[0];
  if (!primaryCrPath) {
    throw new Error('No rendered CR path found for default group claim');
  }

  await client.k8s.applyCr(primaryCrPath);
  await client.k8s.waitForCr(primaryCrPath, WAIT_FOR_CR_TIMEOUT_SECONDS);

  const tfStateKey = await client.k8s.getGroupTfStateKey(name);
  if (!tfStateKey) {
    throw new Error(`Could not resolve tfStateKey for default group '${name}'`);
  }

  await client.claims.restartContext();

  await client.claims.patchContextFile('firestartr', [
    ...buildGroupClaimPatches(name),
    {
      op: 'add',
      path: '/providers/github/tfStateKey',
      value: tfStateKey,
    },
  ]);

  return {
    name,
    ref: `group:${name}`,
    tfStateKey,
  };
}
