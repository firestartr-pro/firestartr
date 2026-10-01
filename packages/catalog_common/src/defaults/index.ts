import { getFromEnvironmentWithDefault } from '../environment';
import { envVars } from '../types/envvars';

const org = getFromEnvironmentWithDefault(envVars.org, '');

/**
 * The default nobody group will be, in order, one of these:
 */
const defaultNoBodyGroup = getFromEnvironmentWithDefault(
  envVars.nobodyGroup,
  'nobody',
);

/**
 * The default owner will be, in order, one of these:
 *   - The defined DEFAULT_OWNER in ENV
 *   - The defined NOBODY_GROUP in  ENV
 *   - The default 'nobody' group/team
 */
const defaultOwner = getFromEnvironmentWithDefault(
  envVars.defaultOwner,
  defaultNoBodyGroup,
);

/**
 * The default system will be, in order, one of these:
 */
const defaultSystem = getFromEnvironmentWithDefault(
  envVars.defaultSystem,
  `${org}-system`,
);

const defaultPlatformTeam = getFromEnvironmentWithDefault(
  envVars.platformGroup,
  `${org}-platform-team`,
);

const fullMembersTeam = getFromEnvironmentWithDefault(
  envVars.fullOrgGroup,
  `${org}-team`,
);

export default {
  org,
  defaultOwner,
  defaultSystem,
  defaultNoBodyGroup,
  defaultPlatformTeam,
  fullMembersTeam,
};
