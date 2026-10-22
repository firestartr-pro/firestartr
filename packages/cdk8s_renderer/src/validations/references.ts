export function validateTfStateKeyUniqueness(crs: any) {
  const tfStateKeys: { [key: string]: any } = {};

  for (const crKey of Object.keys(crs)) {
    const cr = crs[crKey];

    if (!cr.spec?.firestartr?.tfStateKey) continue;

    const tfKey = cr.spec.firestartr.tfStateKey;
    const claimRef = cr.metadata?.annotations?.['firestartr.dev/claim-ref'];

    const existing = tfStateKeys[tfKey];

    if (existing) {
      const existingClaimRef =
        existing.metadata?.annotations?.['firestartr.dev/claim-ref'];

      const sameClaim = claimRef !== undefined && existingClaimRef === claimRef;
      const workspaceInvolved =
        isTerraformWorkspace(cr) || isTerraformWorkspace(existing);

      if (sameClaim && !workspaceInvolved) {
        continue;
      }

      throw new Error(
        `❗❗ ❌ RENDER ERROR ❌ ❗❗

The tfStateKey ${tfKey} is not unique,

It is being used by the following CRs:

- ${existing.kind} ${existing.metadata.name}

- ${cr.kind} ${cr.metadata.name}

Check the following Claims to ensure that the tfStateKey is unique:

- ${existingClaimRef}

- ${claimRef}
`,
      );
    }

    tfStateKeys[cr.spec.firestartr.tfStateKey] = cr;
  }
}

export function isCatalogEntity(cr: any): boolean {
  return [
    'Component',
    'Domain',
    'System',
    'User',
    'Group',
    'Resource',
  ].includes(cr.kind);
}

function isTerraformWorkspace(cr: any): boolean {
  return cr.kind === 'FirestartrTerraformWorkspace';
}
