import lodash from 'lodash';

export function isCollaborator(struc: any) {
  return hasProperties(struc, ['collaborator', 'role']);
}

function hasProperties(struc: any, properties: string[]) {
  for (const property of properties) {
    if (!hasProperty(struc, property)) {
      return false;
    }
  }

  return true;
}

function hasProperty(struc: any, property: string) {
  return lodash.has(struc, property);
}
