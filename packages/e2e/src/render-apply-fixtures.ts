import { createNameBuilder } from './names';
import type { OrgScriptFixture } from './org-script';
import { WAIT_FOR_CR_TIMEOUT_SECONDS } from './test-constants';

import type { E2EApi, JsonPatchOperation } from './types';

export type FixturePatchesByClaimName = Record<string, JsonPatchOperation[]>;

export async function applyAndWaitCrPaths(
  client: E2EApi,
  crPaths: string[],
  waitTimeoutSeconds = WAIT_FOR_CR_TIMEOUT_SECONDS,
): Promise<void> {
  for (const crPath of crPaths) {
    const shortName = crPath.split('/').pop() ?? crPath;
    console.log(`[applyAndWait] START apply ${shortName}`);
    try {
      await client.k8s.applyCr(crPath);
      console.log(
        `[applyAndWait] START waitForCr ${shortName} (timeout=${waitTimeoutSeconds}s)`,
      );
      await client.k8s.waitForCr(crPath, waitTimeoutSeconds);
      console.log(`[applyAndWait] DONE ${shortName}`);
    } catch (err) {
      console.error(`[applyAndWait] FAILED ${shortName}:`, err);
      throw err;
    }
  }
}

export async function renderApplyAndWaitFixtures(
  client: E2EApi,
  fixtures: OrgScriptFixture[],
  extraPatchesByClaimName: FixturePatchesByClaimName,
  waitTimeoutSeconds = WAIT_FOR_CR_TIMEOUT_SECONDS,
): Promise<string[]> {
  const nameBuilder = createNameBuilder(client.getPrefix());
  const renderedCrPaths = new Set<string>();

  for (const fixture of fixtures) {
    const claimName =
      fixture.claimName ?? nameBuilder.build(fixture.fixtureName.trim());
    const extraPatches = extraPatchesByClaimName[claimName] ?? [];

    console.log(
      `[renderApplyAndWait] rendering fixture ${fixture.fixtureName} -> claim ${claimName}`,
    );
    const rendered = await client.claims.renderLocally(fixture.fixtureName, {
      patches: [...(fixture.patches ?? []), ...extraPatches],
    });

    for (const renderedCrPath of rendered.crPaths) {
      renderedCrPaths.add(renderedCrPath);
      console.log(`[renderApplyAndWait] rendered CR: ${renderedCrPath}`);
    }
  }

  const allRenderedCrPaths = [...renderedCrPaths];
  console.log(`[renderApplyAndWait] applying ${allRenderedCrPaths.length} CRs`);
  await applyAndWaitCrPaths(client, allRenderedCrPaths, waitTimeoutSeconds);

  return allRenderedCrPaths;
}
