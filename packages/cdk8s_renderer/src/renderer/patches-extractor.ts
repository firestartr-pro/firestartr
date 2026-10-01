import { generateFeaturesPatches } from '../charts/github/featureRenderer';
import { ICustomResourcePatch } from '../patches';
import { RenderClaimData } from './types';

export async function extractPatches(
  claimToRenderData: RenderClaimData,
  previousCR: any,
  crs?: any,
): Promise<ICustomResourcePatch[]> {
  let totalPatches: ICustomResourcePatch[] = [];

  for (const normalizer of claimToRenderData.normalizers) {
    const patches = await normalizer.patches(
      claimToRenderData['claim'],
      previousCR,
    );

    totalPatches = totalPatches.concat(patches).flat();
  }

  for (const initializer of claimToRenderData.initializers) {
    const patches = await initializer.patches(
      claimToRenderData['claim'],
      previousCR,
    );

    totalPatches = totalPatches.concat(patches).flat();
  }

  for (const overrider of claimToRenderData.overrides) {
    const patches = await overrider.patches(
      claimToRenderData['claim'],
      previousCR,
      crs,
    );

    totalPatches = totalPatches.concat(patches).flat();
  }

  if (claimToRenderData.claim.kind === 'ComponentClaim') {
    totalPatches = totalPatches
      .concat(await generateFeaturesPatches(claimToRenderData.claim))
      .flat();
  }

  for (const global of claimToRenderData.globals) {
    const patches = await global.patches(claimToRenderData.claim, previousCR);

    totalPatches = totalPatches.concat(patches).flat();
  }

  return totalPatches;
}
