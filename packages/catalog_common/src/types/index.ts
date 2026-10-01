import { envVars } from './envvars';
import * as regex from './regex';
import {
  KindTypes,
  StatusTypes,
  ArtifactStatuses,
  FeatureStatuses,
  getClaimKindFromCrKind,
  getCrKindFromClaimKind,
  getProviderFromCrKind,
} from './catalog';
import FirestartrConfig from './firestartr_config';
import controller from './controller';

export default {
  ArtifactStatuses,

  envVars,

  KindTypes,

  StatusTypes,

  ActionTypes: StatusTypes,

  FirestartrConfig,

  FeatureStatuses,

  controller,

  getClaimKindFromCrKind,

  getCrKindFromClaimKind,

  getProviderFromCrKind,

  regex,
};
