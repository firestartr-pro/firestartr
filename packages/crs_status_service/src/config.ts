import common from 'catalog_common';

export interface ServiceConfig {
  port: number;
  kindList: string[];
  namespace: string;
  apiGroup: string;
  apiVersion: string;
  tombstoneTtlMs: number;
}

const DEFAULT_PORT = 9091;
const DEFAULT_API_GROUP = 'firestartr.dev';
const DEFAULT_API_VERSION = 'v1';
const DEFAULT_TOMBSTONE_TTL_MS = 3600 * 1000;

export function loadConfig(): ServiceConfig {
  const kindListRaw = common.environment.getFromEnvironment(
    common.types.envVars.crsStatusKindList,
  );
  const kindList = kindListRaw
    ? kindListRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (kindList.length === 0) {
    throw new Error(
      `${common.types.envVars.crsStatusKindList} must specify at least one kind`,
    );
  }

  const namespace = common.environment.getFromEnvironment(
    common.types.envVars.crsStatusNamespace,
  );
  if (!namespace) {
    throw new Error(`${common.types.envVars.crsStatusNamespace} is required`);
  }

  const portRaw = common.environment.getFromEnvironmentWithDefault(
    common.types.envVars.crsStatusPort,
    String(DEFAULT_PORT),
  );
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `${common.types.envVars.crsStatusPort} must be a valid TCP port`,
    );
  }

  const apiGroup = common.environment.getFromEnvironmentWithDefault(
    common.types.envVars.crsStatusApiGroup,
    DEFAULT_API_GROUP,
  );

  const apiVersion = common.environment.getFromEnvironmentWithDefault(
    common.types.envVars.crsStatusApiVersion,
    DEFAULT_API_VERSION,
  );

  const tombstoneTtlRaw = common.environment.getFromEnvironmentWithDefault(
    common.types.envVars.crsStatusTombstoneTtl,
    String(DEFAULT_TOMBSTONE_TTL_MS),
  );
  const tombstoneTtlMs = Number(tombstoneTtlRaw);
  if (!Number.isFinite(tombstoneTtlMs) || tombstoneTtlMs < 0) {
    throw new Error(
      `${common.types.envVars.crsStatusTombstoneTtl} must be a non-negative number of milliseconds`,
    );
  }

  const config: ServiceConfig = {
    port,
    kindList,
    namespace,
    apiGroup,
    apiVersion,
    tombstoneTtlMs,
  };

  return Object.freeze(config);
}
