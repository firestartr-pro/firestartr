import common from 'catalog_common';
import YAML from 'yaml';
import _ from 'lodash';
import { RenderClaimKey, RenderClaims } from '../renderer/types';

import {
  isRepoSecretRef,
  extractRepoSecretRef,
} from '../utils/repositoryClaimUtils';

import log from '../logger';

const kindMap = {
  user: 'UserClaim',
  group: 'GroupClaim',
  system: 'SystemClaim',
  secret: 'SecretsClaim',
  domain: 'DomainClaim',
};

// this function is intended to search for refs of the same kind
// it is used to search for circular references (i.e. a reference to oneself)
// to extract all type of references use extractAllRefs
export function extractRefs(renderClaims: RenderClaims, kind: string) {
  const result: any = {};

  for (const key in renderClaims) {
    const claim = (renderClaims[key as RenderClaimKey] as any).claim;

    let refs = [];
    // for workspaces
    let [tfWorkspaceRefs, secretsRefs] = [[], []];

    switch (kind) {
      case 'TFWorkspaceClaim':
        [tfWorkspaceRefs, secretsRefs] = getTfWorkspacesRefs(
          claim.providers.terraform.values,
        );

        refs = [...tfWorkspaceRefs];

        break;

      case 'GroupClaim':
        /**
         * Groups can have refs to other groups in parent property
         **/
        refs = getGroupParentRef(claim.parent);

        break;

      default:
        throw new Error(`No refs for kind ${kind}`);
    }

    result[claim.name] = {
      name: `${claim.kind}-${claim.name}`,
      refs: refs,
    };
  }

  return result;
}

export function extractAllRefs(claimData: string) {
  const refs = getClaimReferences(claimData);
  const parsedClaim = YAML.parse(claimData);

  refs.push(...extractVirtualRefs(parsedClaim));

  switch (parsedClaim.kind) {
    case 'TFWorkspaceClaim': {
      const [tfWorkspaceRefs, secretRefs] = getTfWorkspacesRefs(
        parsedClaim.providers.terraform.values,
      );
      tfWorkspaceRefs.forEach((ref, idx, arr) => {
        arr[idx] = `TFWorkspaceClaim-${ref}`;
      });

      log.debug(
        `Obtained the following secret refs for ${parsedClaim.kind}/${parsedClaim.name}: ${JSON.stringify(secretRefs)}`,
      );

      refs.push(...tfWorkspaceRefs);
      refs.push(...secretRefs);

      break;
    }

    case 'GroupClaim': {
      const groupRefs = getGroupParentRef(parsedClaim.parent);
      groupRefs.forEach((ref, idx, arr) => {
        arr[idx] = `GroupClaim-${ref}`;
      });
      refs.push(...groupRefs);
      break;
    }

    case 'ComponentClaim': {
      const secretsRefs = getComponentVarsAndSecretsRefs(parsedClaim);
      refs.push(...secretsRefs);
      break;
    }

    case 'OrgSettingsClaim': {
      const actionsVariables = parsedClaim.providers?.github?.actions_variables;
      if (Array.isArray(actionsVariables)) {
        for (const variable of actionsVariables) {
          if (variable.visibility !== 'selected') continue;
          const selectedRepos = variable.selected_repositories;
          if (!Array.isArray(selectedRepos)) continue;
          for (const repoRef of selectedRepos) {
            const match = repoRef.match(/^component:(.+)$/);
            if (match) {
              refs.push(`ComponentClaim-${match[1]}`);
            }
          }
        }
      }
      break;
    }
  }

  log.info(
    `Refs for ${parsedClaim.kind}-${parsedClaim.name}: ${[...new Set(refs)].join(',')}`,
  );

  return [...new Set(refs)];
}

function extractVirtualRefs(parsedClaim: any) {
  const virtualRefs = [];

  switch (parsedClaim.kind) {
    case 'ComponentClaim': {
      if (
        parsedClaim.providers.github.orgPermissions === 'view' ||
        parsedClaim.providers.github.orgPermissions === 'contribute'
      ) {
        log.info(
          `Adding virtual reference for ${parsedClaim.providers.github.org}-all`,
        );
        virtualRefs.push(`GroupClaim-${parsedClaim.providers.github.org}-all`);
      }

      break;
    }
  }

  return virtualRefs;
}

export function getGroupParentRef(parent: string, references: any[] = []) {
  if (!parent) return [];

  const regex = common.types.regex.GroupRefRegex;

  for (const match of parent.matchAll(regex)) {
    log.debug(
      `getGroupParentRef: a match has been found for ${parent}: ${match}`,
    );
    const [_, claimName] = match;
    references.push(claimName);
  }

  return references;
}

export function getTfWorkspacesRefs(
  values: any,
  references: any[] = [],
  secretsRefs: any[] = [],
) {
  const regex = common.types.regex.TFWorkspaceRefRegex;

  for (const key in values) {
    switch (typeof values[key]) {
      case 'object':
        getTfWorkspacesRefs(values[key], references, secretsRefs);
        break;

      case 'string':
        // Extract all implicit refs
        for (const match of values[key].matchAll(regex)) {
          const [_, claimName] = match;
          references.push(claimName);
        }

        // extract a secretsclaim ref
        if (isRepoSecretRef(values[key])) {
          const secretRef = extractRepoSecretRef(values[key]);
          secretsRefs.push(`SecretsClaim-${secretRef.name}`);
        }
        break;
    }
  }

  return [references, secretsRefs];
}

export function getComponentVarsAndSecretsRefs(parsedClaim: any) {
  const refs = {};

  const githubProvider = parsedClaim.providers?.github;

  if (githubProvider) {
    const varsBlock: any = githubProvider.vars;

    const secretsBlock: any = githubProvider.secrets;

    if (varsBlock) {
      for (const block of Object.keys(varsBlock)) {
        for (const refVar of varsBlock[block]) {
          if (isRepoSecretRef(refVar.value)) {
            const secretRef = extractRepoSecretRef(refVar.value);

            refs[`SecretsClaim-${secretRef.name}`] = true;
          }
        }
      }
    }

    if (secretsBlock) {
      for (const block of Object.keys(secretsBlock)) {
        for (const secret of secretsBlock[block]) {
          const secretRef = extractRepoSecretRef(secret.value);

          refs[`SecretsClaim-${secretRef.name}`] = true;
        }
      }
    }
  }

  return Object.keys(refs);
}

function getClaimReferences(claim: string) {
  const headerRegex = common.types.regex.YAMLHeaderRegex;
  const multilineRegex = common.types.regex.YAMLMultilineRegex;
  const listItemRegex = common.types.regex.YAMLListItemRegex;
  const inlineListRegex = common.types.regex.YAMLInlineListRegex;
  const valueRegex = common.types.regex.GenericRefRegex;
  const secretRegex = common.types.regex.SecretRefRegex;

  const refs = [];
  let multilineMargin = -1;

  for (const line of claim.split('\n')) {
    if (multilineMargin >= 0) {
      const currentLineMargin = line.length - line.trimStart().length;

      if (currentLineMargin > multilineMargin) {
        continue;
      } else {
        multilineMargin = -1;
      }
    }

    if (!line.match(headerRegex) && !line.match(listItemRegex)) continue;

    let lineValue = line.match(headerRegex)
      ? line.replace(headerRegex, '')
      : line.replace(listItemRegex, '');

    if (lineValue.match(valueRegex)) {
      lineValue = lineValue.replace(/"/g, '').replace(/'/g, '');
      let pendingRefs = [];

      if (lineValue.match(inlineListRegex)) {
        lineValue = lineValue
          .replace('[', '')
          .replace(']', '')
          .replace(/\s/g, '');
        pendingRefs = lineValue.split(',');
      } else {
        pendingRefs.push(lineValue);
      }

      for (const ref of pendingRefs) {
        refs.push(resolveFirestartrRef(ref));
      }
    } else if (lineValue.match(secretRegex)) {
      lineValue = lineValue
        .replace(/"/g, '')
        .replace(/'/g, '')
        .replace(/\$/g, '')
        .replace(/\{/g, '')
        .replace(/\s/g, '');

      const secretRef = lineValue.split('.')[0];

      refs.push(resolveFirestartrRef(secretRef));
    } else if (lineValue.match(multilineRegex)) {
      multilineMargin = line.length - line.trimStart().length;
    }
  }

  return refs;
}

function resolveFirestartrRef(reference: string) {
  const splittedRef = reference.split(':');

  if (splittedRef.length === 2)
    return `${kindMap[splittedRef[0]]}-${splittedRef[1]}`;

  return '';
}
