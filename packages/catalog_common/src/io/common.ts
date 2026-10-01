import * as path from 'path';

import YAML from 'yaml';

import log from '../logger';

export const ComponentPaths: Array<string> = [
  'apiVersion',
  'kind',
  'metadata',
  'metadata/name',
  'metadata/description',
  'metadata/annotations',
  'spec',
  'spec/type',
  'spec/lifecycle',
  'spec/owner',
  'spec/maintainedBy',
  'spec/platformOwner',
  'spec/provisioner',
  'spec/provisioner/org',
  'spec/provisioner/orgPermissions',
  'spec/provisioner/technology',
  'spec/provisioner/technology/stack',
  'spec/provisioner/technology/version',
  'spec/provisioner/repo',
  'spec/provisioner/repo/visibility',
  'spec/provisioner/repo/ciSystem',
  'spec/provisioner/repo/defaultBranch',
  'spec/provisioner/repo/branchStrategy',
  'spec/provisioner/repo/additionalCodeownersRules',
  'spec/provisioner/repo/branches',
  'spec/provisioner/repo/branches/protections',
  'spec/provisioner/repo/branches/protections/override',

  'spec/provisioner/features',

  'spec/system',
];

export const UserPaths: Array<string> = [
  'apiVersion',
  'kind',
  'metadata',
  'metadata/name',
  'metadata/annotations',
  'spec',
  'spec/profile',
  'spec/profile/displayName',
  'spec/profile/email',
  'spec/profile/picture',
  'spec/memberOf',
  'spec/provisioner',
  'spec/provisioner/role',
];

export const GroupPaths: Array<string> = [
  'apiVersion',
  'kind',
  'metadata',
  'metadata/name',
  'metadata/description',
  'metadata/annotations',
  'spec',
  'spec/type',
  'spec/profile',
  'spec/profile/displayName',
  'spec/profile/email',
  'spec/profile/picture',
  'spec/children',
  'spec/members',
  'spec/provisioner',
];

export const SystemPaths: Array<string> = [
  'apiVersion',
  'kind',
  'metadata',
  'metadata/name',
  'metadata/description',
  'metadata/annotations',
  'spec',
  'spec/owner',
  'spec/domain',
  'spec/provisioner',
];

function transformKind(kind: string) {
  if (kind.match(/s$/)) {
    return kind.toLowerCase();
  } else {
    return (kind + 's').toLowerCase();
  }
}

export function getPath(kind: string, name: string, catalogPath: string) {
  log.debug(
    `Getting path for kind ${kind} and name ${name} in catalog path ${catalogPath}`,
  );

  return path.join(catalogPath, transformKind(kind), name + '.yaml');
}

export function getKindPath(kind: string, catalogPath: string) {
  log.debug(`Getting path for kind ${kind} in catalog path ${catalogPath}`);

  return path.join(catalogPath, transformKind(kind));
}

export function fromYaml(data: string) {
  const result = YAML.parse(data);
  log.debug('Loading YAML data: %O', result);

  return result;
}

export function toYaml(data: any, opts: any = {}) {
  log.debug('opts', opts);
  const result = YAML.stringify(data);
  return result;
}

export function dumpYaml(data: any) {
  log.debug('Dumping object data to YAML %O', data);

  return YAML.stringify(data);
}
