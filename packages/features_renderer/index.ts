import validate from './src/validate';
import render, {
  buildContext,
  renderContent,
  expandFiles,
  getClaimPatches,
  isFeatureArgsValidationEnabled,
} from './src/render';
import auxiliar from './src/auxiliar';
import updateFileContent from './src/update_file';
import { validateFeatureArgs } from './src/featureArgsValidation';

export {
  getClaimPatches,
  buildContext,
  renderContent,
  expandFiles,
  isFeatureArgsValidationEnabled,
};

export default {
  validate,
  render,
  updateFileContent,
  auxiliar,
  buildContext,
  renderContent,
  expandFiles,
  validateFeatureArgs,
  isFeatureArgsValidationEnabled,
  getClaimPatches,
};
