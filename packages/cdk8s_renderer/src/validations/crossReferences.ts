import { RenderClaims } from '../renderer/types';

import { isRepoSecretRef } from '../utils/repositoryClaimUtils';

const IS_COMPONENT_CLAIM_REF = new RegExp(/^ComponentClaim-/);
const IS_TF_WORKSPACE = new RegExp(/^TFWorkspaceClaim-/);
const IS_ORG_SETTINGS_CLAIM = new RegExp(/^OrgSettingsClaim-/);
const COMPONENT_REF_PATTERN = /^component:(.+)$/;

export function validateSubReferences(renderClaims: RenderClaims): void {
  for (const ref of Object.keys(renderClaims)) {
    if (IS_COMPONENT_CLAIM_REF.test(ref))
      validateClaimsSecretsRefs(ref, renderClaims);
    else if (IS_TF_WORKSPACE.test(ref))
      validateTFClaimsSecretsRefs(ref, renderClaims);
    else if (IS_ORG_SETTINGS_CLAIM.test(ref))
      validateOrgSettingsComponentRefs(ref, renderClaims);
  }
}

function validateTFClaimsSecretsRefs(ref: string, renderClaims: RenderClaims) {
  const claim = renderClaims[ref].claim;

  const values = claim.providers?.terraform?.values as string[];

  const secretRefs: string[] = Object.values(values).filter((v: string) =>
    isRepoSecretRef(v),
  );

  for (const secret of secretRefs) {
    const [secretName, key] = secret.split(':').slice(2);

    const keyFound = searchSecretKey(
      renderClaims[`SecretsClaim-${secretName}`].claim,

      key,
    );

    if (!keyFound) {
      throw new Error(
        `CrossReference error: TFWorkspaceClaim/${claim.name} references a non-existent secret key: '${secretName}:${key}'`,
      );
    }
  }
}

function validateClaimsSecretsRefs(ref: string, renderClaims: RenderClaims) {
  const claim = renderClaims[ref].claim;

  const secrets = claim.providers.github.secrets;

  if (!secrets) {
    return;
  }

  for (const section of ['actions', 'codespaces', 'dependabot']) {
    const secretsSection = secrets[section];

    if (!secretsSection) {
      continue;
    }

    for (const secret of secretsSection) {
      const [secretName, key] = secret.value.split(':').slice(2);

      const keyFound = searchSecretKey(
        renderClaims[`SecretsClaim-${secretName}`].claim,

        key,
      );

      if (!keyFound) {
        throw new Error(
          `CrossReference error: ComponentClaim/${claim.name} references a secret key inexistent: '${secretName}/${key}'`,
        );
      }
    }
  }
}

function searchSecretKey(secretClaim: any, key: string): boolean {
  let found = false;

  if ('pushSecrets' in secretClaim.providers['external_secrets']) {
    found =
      secretClaim.providers['external_secrets'].pushSecrets.find(
        (secret: any) => {
          return secret.secretName === key;
        },
      ) !== undefined;
  }

  if (
    !found &&
    'externalSecrets' in secretClaim.providers['external_secrets']
  ) {
    found =
      secretClaim.providers['external_secrets'].externalSecrets.secrets.find(
        (secret: any) => {
          return secret.secretName === key;
        },
      ) !== undefined;
  }

  return found;
}

function validateOrgSettingsComponentRefs(
  ref: string,
  renderClaims: RenderClaims,
): void {
  const claim = renderClaims[ref].claim;
  validateActionsVariablesSelectedRepositories(claim, renderClaims);
}

function validateActionsVariablesSelectedRepositories(
  claim: any,
  renderClaims: RenderClaims,
): void {
  const actionsVariables = claim?.providers?.github?.actions_variables;
  if (!Array.isArray(actionsVariables)) return;

  for (const variable of actionsVariables) {
    if (variable.visibility !== 'selected') continue;
    const selectedRepos = variable.selected_repositories;
    if (!Array.isArray(selectedRepos) || selectedRepos.length === 0) continue;

    for (const ref of selectedRepos) {
      const match = ref.match(COMPONENT_REF_PATTERN);
      if (!match) continue;

      const componentName = match[1];
      const expectedKey = `ComponentClaim-${componentName}`;

      if (!renderClaims[expectedKey]) {
        throw new Error(
          `CrossReference error: OrgSettingsClaim/${claim.name} references a non-existent component "${componentName}" in actions_variables.${variable.name}.selected_repositories`,
        );
      }
    }
  }
}
