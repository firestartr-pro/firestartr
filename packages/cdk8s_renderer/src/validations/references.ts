export function validateTfStateKeyUniqueness(crs: any) {
  const tfStateKeys: { [key: string]: any } = {};

  for (const crKey of Object.keys(crs)) {
    const cr = crs[crKey];

    if (!isTerraformWorkspace(cr)) continue;

    const tfKey = cr.spec.firestartr.tfStateKey;

    if (tfStateKeys[tfKey]) {
      throw new Error(
        `❗❗ ❌ RENDER ERROR ❌ ❗❗

The tfStateKey ${tfKey} is not unique,

It is being used by the following CRs:

- ${tfStateKeys[tfKey].kind} ${tfStateKeys[tfKey].metadata.name}

- ${cr.kind} ${cr.metadata.name}

Check the following Claims to ensure that the tfStateKey is unique:

- ${tfStateKeys[tfKey].metadata.annotations['firestartr.dev/claim-ref']}

- ${cr.metadata.annotations['firestartr.dev/claim-ref']}
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
