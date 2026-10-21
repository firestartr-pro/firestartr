// this is a factory
// instantiates a particular entity
// according to the CR's Kind

import { EntityCR } from './cr';

import { Entity } from './base';

import type { Dependencies } from '../refs';

import { EntityGroup } from './group';
import { EntityGHRepositorySecretsSection } from './ghrepositorysecretssection';
import { EntityGHRepo } from './ghrepo';
import { EntityGHFeature } from './ghfeature';
import { EntityGHMembership } from './ghmembership';
import { EntityGHOrgSettings } from './ghorgsettings';
import { EntityGHOrgVarsSection } from './ghorgvarsection';
import { EntityGHOrgWebHook } from './ghorgwebhook';

import log from '../logger';

export { EntityCR } from './cr';

export { Entity } from './base';

export type EntityConstructor<T extends Entity = Entity> = new (
  cr: any,
  deps?: Dependencies,
) => T;

export function getEntity(cr: any, deps?: Dependencies): Entity {
  const entityClass: EntityConstructor = getEntityClass(
    cr.kind,
  ) as EntityConstructor;

  return new entityClass(cr, deps);
}

function getEntityClass(kind: string): EntityConstructor {
  switch (kind) {
    case 'FirestartrGithubGroup':
      return EntityGroup as EntityConstructor;
    case 'FirestartrGithubRepositorySecretsSection':
      return EntityGHRepositorySecretsSection as EntityConstructor;
    case 'FirestartrGithubRepository':
      return EntityGHRepo as EntityConstructor;
    case 'FirestartrGithubRepositoryFeature':
      return EntityGHFeature as EntityConstructor;
    case 'FirestartrGithubMembership':
      return EntityGHMembership as EntityConstructor;
    case 'FirestartrGithubOrgWebhook':
      return EntityGHOrgWebHook as EntityConstructor;
    case 'FirestartrGithubOrganizationSettings':
      return EntityGHOrgSettings as EntityConstructor;
    case 'FirestartrGithubOrganizationVariableSection':
      return EntityGHOrgVarsSection as EntityConstructor;

    default:
      throw new Error(`kind ${kind} has no entity associated`);
  }
}
