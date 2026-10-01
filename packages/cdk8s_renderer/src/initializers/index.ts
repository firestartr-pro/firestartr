import { UUIDInitializer } from './uuid';
import { TechnologyInitializer } from './technology';
import { InitializerDefault } from '../defaults/initializer';
import TechnologySchema from '../schemas/technologies';
import DefaultSchema from '../schemas/default';
import { InitializerClaimRef } from './claimRef';
import { BackstageInitializer } from './backstage';
import { SyncerInitializer } from './syncer';
import { PolicyInitializer } from './policy';
import { MetadataInitializer } from './metadata';
import { ComponentLabelsInitializer } from './component_labels';

export const INITIALIZERS: any[] = [
  UUIDInitializer,

  InitializerClaimRef,

  BackstageInitializer,

  PolicyInitializer,

  SyncerInitializer,

  MetadataInitializer,

  ComponentLabelsInitializer,
];

export const INITIALIZERS_BY_FILE_NAME: any = {
  [TechnologyInitializer.FILE_NAME()]: TechnologyInitializer,

  defaults_github_repository: InitializerDefault,

  defaults_github_membership: InitializerDefault,

  defaults_github_group: InitializerDefault,

  defaults_github_orgwebhook: InitializerDefault,

  defaults_github_orgsettings: InitializerDefault,
};

export const SCHEMAS_BY_INITIALIZER_NAME: any = {
  [TechnologyInitializer.FILE_NAME()]: TechnologySchema,

  global_github_repository: DefaultSchema,

  global_github_membership: DefaultSchema,

  global_github_group: DefaultSchema,
};
