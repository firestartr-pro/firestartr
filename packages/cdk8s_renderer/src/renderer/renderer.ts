import { Construct } from 'constructs';
import { IRenameResult, loadClaimsList } from '../loader/loader';
import { validateTfStateKeyUniqueness } from '../validations/references';
import { validateCrSizes } from '../validations/crSize';
import { validatePermissionsUniqueness } from '../validations/permissions';
import { validateNoBackstageAnnotationsInK8sCrs } from '../validations/backstageAnnotations';
import { RenderClaims, RenderedCrMap } from './types';
import { renderClaims } from './claims-render';
import logger from '../logger';
import { validateSubReferences } from '../validations/crossReferences';
import { validateComponentPagesPath } from '../validations/componentPagesPath';
import { validateGithubOrgSettingsSingleton } from '../validations/githubOrgSettings';
import {
  validateGithubOrgVariableSectionSingleton,
  validateActionsVariablesUniqueness,
} from '../validations/githubOrgVariableSection';

/*
 * Function called when rendering but not importing
 *
 * Input:
 * - scope: an object, used to represent CDKTF's execution scope
 *
 * Return:
 * - The result of rendering the renderClaims object, plus the
 *   rendered firestartr-all group
 *
 */
export async function render(
  catalogScope: Construct,

  firestartrScope: Construct,

  claimList: AsyncGenerator<string, void, unknown>,
): Promise<RenderedCrMap> {
  const data: {
    renderClaims: RenderClaims;
    crs: any;
    fullCrs: any;
    renames?: IRenameResult[];
  } = await loadClaimsList(claimList);

  const result: any = await renderClaims(catalogScope, firestartrScope, data);
  const fullCrSet = {
    ...data.fullCrs,
    ...result,
  };

  try {
    validateSubReferences(data.renderClaims);
    validateComponentPagesPath(data.renderClaims);
    validateTfStateKeyUniqueness(result);
    validateGithubOrgSettingsSingleton(fullCrSet);
    validateGithubOrgVariableSectionSingleton(fullCrSet);
    validateActionsVariablesUniqueness(result);
    validateCrSizes(result);
    validatePermissionsUniqueness(result);
    validateNoBackstageAnnotationsInK8sCrs(result);
  } catch (e) {
    logger.error(e.message);
    throw e;
  }

  return result;
}
