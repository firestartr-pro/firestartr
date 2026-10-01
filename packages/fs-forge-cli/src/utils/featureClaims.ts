import { readFile } from 'fs/promises';

import { loadClaimsMap, resolveClaim } from '../claims/claimsMap.js';
import { ClaimsClient } from '../claims/client.js';
import { deterministicPath } from '../claims/deterministicPath.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import { parseClaimYaml, requireOrg } from '../mutations/support.js';

import type { WorkflowDispatchResult } from '../claims/client.js';

export interface ComponentTarget {
  claim: Record<string, unknown>;
  name: string;
  publish(output: string): Promise<WorkflowDispatchResult | undefined>;
}

export async function loadComponentTarget(options: {
  component?: string;
  file?: string;
  org?: string;
  commit?: boolean;
}): Promise<ComponentTarget> {
  if (Boolean(options.component) === Boolean(options.file)) {
    throw new Error(
      'Provide exactly one target: positional COMPONENT or --file <path>',
    );
  }

  if (options.file) {
    const claim = parseClaimYaml(await readFile(options.file, 'utf8'));
    const name = assertComponentClaim(claim);
    return {
      claim,
      name,
      publish: async (output) => {
        if (!options.commit) return undefined;
        const client = new ClaimsClient(requireOrg(options.org));
        const path = deterministicPath('ComponentClaim', name);
        const branch = await client.getDefaultBranch();
        const current = await client.getFile(path, branch);
        return client.publishClaim(
          'ComponentClaim',
          name,
          path,
          output,
          current?.sha,
        );
      },
    };
  }

  const client = new ClaimsClient(requireOrg(options.org));
  const map = await loadClaimsMap(client);
  const source = await resolveClaim(
    client,
    map,
    `ComponentClaim-${options.component}`,
  );
  const claim = parseClaimYaml(source.content);
  const name = assertComponentClaim(claim, options.component);
  return {
    claim,
    name,
    publish: async (output) =>
      options.commit
        ? client.publishClaim(
            'ComponentClaim',
            name,
            source.filePath,
            output,
            source.sha,
          )
        : undefined,
  };
}

export function assertComponentClaim(
  claim: Record<string, unknown>,
  expectedName?: string,
): string {
  if (claim.kind !== 'ComponentClaim') {
    throw new Error('Feature operations require a ComponentClaim');
  }
  if (typeof claim.name !== 'string' || !claim.name) {
    throw new Error('ComponentClaim is missing a valid name');
  }
  if (expectedName !== undefined && claim.name !== expectedName) {
    throw new Error(
      `Resolved claim identity does not match ComponentClaim-${expectedName}`,
    );
  }
  return claim.name;
}

export function formatClaim(
  claim: Record<string, unknown>,
  json: boolean,
): string {
  return json ? JSON.stringify(claim, null, 2) : serializeClaim(claim);
}

export async function writeAndPublishClaim(
  target: ComponentTarget,
  claim: Record<string, unknown>,
  json: boolean,
): Promise<WorkflowDispatchResult | undefined> {
  process.stdout.write(`${formatClaim(claim, json)}\n`);
  return target.publish(formatClaim(claim, false));
}
