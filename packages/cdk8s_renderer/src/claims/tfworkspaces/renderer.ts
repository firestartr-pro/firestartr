import { App } from 'cdk8s';
import { TFWorkspaceChart } from '../../charts/workspaces/tfworkspaceChart';
import { NameNormalizer } from '../../normalizers/name';
import { RefValuesNormalizer } from '../../normalizers/refValues';
import { UUIDInitializer } from '../../initializers/uuid';
import { InitializerClaimRef } from '../../initializers/claimRef';

import log from '../../logger';

export async function renderTfWorkspace(
  claim: any,

  firestartrId: string | undefined,

  resolveRef: Function,

  namespace: string,
) {
  const app = new App();

  const initializers = [new UUIDInitializer(), new InitializerClaimRef()];

  const previousCR = await resolveRef('TFWorkspace', claim.name, namespace);

  if (previousCR) {
    log.info(
      `💊 Previous CR found for ${claim.name} in ${namespace} with tfStateKey ${previousCR.spec.firestartr.tfStateKey}`,
    );
  } else {
    log.info(
      `💊 No previous CR found for ${claim.name} in ${namespace}, it will be rendered from scratch`,
    );
  }

  const refValuesNormalizer = new RefValuesNormalizer();

  refValuesNormalizer.rsClaimRef = (kind: string, name: string) =>
    resolveRef(kind, name, namespace);

  const normalizers: any[] = [refValuesNormalizer, new NameNormalizer()];

  let totalPatches: any[] = [];

  for (const normalizer of normalizers) {
    const patches = await normalizer.patches(claim, previousCR);

    totalPatches = totalPatches.concat(patches).flat();
  }

  for (const initializer of initializers) {
    const patches = await initializer.patches(claim, previousCR);

    totalPatches = totalPatches.concat(patches).flat();
  }

  const tfWkChart = new TFWorkspaceChart(
    app,
    'tfwk',
    firestartrId || null,
    claim,
    totalPatches,
  );

  await tfWkChart.render();

  const apiObject = await tfWkChart.postRenderer([]);

  const jsonObject = await apiObject.toJson();

  log.info(`📦 CR rendered \n ${jsonObject}`);

  return jsonObject;
}
