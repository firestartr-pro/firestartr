export type { CollectionFilter } from './collections';
import type { CollectionFilter } from './collections';
import GroupCollectionGithubDecanter from './gh/github_group_collection';
import MemberCollectionGithubDecanter from './gh/github_member_collection';
import OrgSettingsCollectionGithubDecanter from './gh/github_org_settings_collection';
import RepoCollectionGithubDecanter from './gh/github_repo_collection';
import cdk8s_renderer, {
  RenderClaims,
  emptyRenderedClaims,
  setRenderedClaim,
} from 'cdk8s_renderer';
import common from 'catalog_common';
import * as path from 'path';
import {
  setClaimsPath,
  setConfigPath,
  setResourcesPath,
  getResourcesPath,
  resolveDefaultOwnerHandles,
} from './config';

import log from '../logger';

// A single claim can render multiple CRs.
// Some of those rendered kinds are derived/child resources whose parent is the
// main CR for the claim, so they do not correspond to claim files that should be moved.
const CHILD_CR_KINDS = [
  'FirestartrGithubRepositorySecretsSection',
  'FirestartrGithubRepositoryFeature',
];

const MAP_COLLECTION_KIND_CR_KIND: Record<string, string> = {
  'gh-repo': 'FirestartrGithubRepository',
  'gh-group': 'FirestartrGithubGroup',
  'gh-members': 'FirestartrGithubMembership',
  'gh-org-settings': 'FirestartrGithubOrganizationSettings',
};

let previousCRs: any = {};

export const collections = {
  GroupCollectionGithubDecanter,

  MemberCollectionGithubDecanter,

  OrgSettingsCollectionGithubDecanter,

  RepoCollectionGithubDecanter,
};

export function isInPreviousCRs(kind: string, name: string) {
  const crKind = MAP_COLLECTION_KIND_CR_KIND[kind];
  if (!crKind) return false;
  return `${crKind}-${name}` in previousCRs;
}

const randomFolder: string = path.join(
  '/tmp',
  `claims_${common.generic.randomString(10)}`,
);

const tmpRenderedCrsPath: string = path.join('/tmp', '.resources');

export async function setPreviousCRs(resourcesPath: string, org?: string) {
  const crs = await cdk8s_renderer.loadCRs(resourcesPath, [
    path.join(resourcesPath, '.github'),
    path.join(resourcesPath, '.config'),
    path.join(resourcesPath, '.import'),
  ]);

  const alreadyImportedCrs: any = {};

  emptyRenderedClaims();

  const claimRefAnnotation =
    common.generic.getFirestartrAnnotation('claim-ref');

  for (const value of Object.values(crs)) {
    const resourceName = (value as any).metadata.annotations[
      common.generic.getFirestartrAnnotation('external-name')
    ];

    const resourceKind = (value as any).kind;

    alreadyImportedCrs[`${resourceKind}-${resourceName}`] = value;

    // Seed the renderer's claim symbol table from already-imported CRs so that
    // claim references (e.g. the default owner "group:group_a") can be resolved
    // to their external names through the same mapping used by CODEOWNERS.
    const claimRef = (value as any).metadata?.annotations?.[claimRefAnnotation];
    if (claimRef && typeof claimRef === 'string' && claimRef.includes('/')) {
      const [claimKind, claimName] = claimRef.split('/');
      if (
        (claimKind === 'GroupClaim' || claimKind === 'UserClaim') &&
        claimName
      ) {
        setRenderedClaim({ kind: claimKind, name: claimName }, value);
      }
    }
  }

  previousCRs = alreadyImportedCrs;

  if (org) {
    resolveDefaultOwnerHandles(org, crs);
  }

  emptyRenderedClaims();
}

export async function importGithubGitopsRepository(
  org: string,

  skipPlan: boolean,

  claimsPath: string,

  resourcesPath: string,

  configPath: string,

  filters: CollectionFilter[] = [],

  needsReImport: boolean,

  force: boolean,
) {
  await setPreviousCRs(resourcesPath, org);

  configurePaths(
    randomFolder,

    '/tmp/tmp-resources', // Not used, but required by renderer

    configPath,
  );

  log.info(`Importing gitops repository for organization: ${org}`);

  const data: any = await getDataFromKinds(org, filters, needsReImport);

  data.crs = {};

  for (const k of Object.keys(previousCRs)) {
    data.crs[`${previousCRs[k].kind}-${previousCRs[k].metadata.name}`] =
      previousCRs[k];
  }

  const crs = await renderCRs(data);

  for (const key in crs) {
    let cr = crs[key];

    const claimName =
      cr.metadata?.annotations?.[
        common.generic.getFirestartrAnnotation('claim-ref')
      ]?.split('/')[1];

    const postRenderFunctions =
      data.postRender[`${cr.kind}-${claimName}`] || [];

    let crModified = false;

    for (const postRenderFunction of postRenderFunctions) {
      cr = postRenderFunction(cr);

      crModified = true;
    }

    if (crModified) {
      const crPath = getCrPath(tmpRenderedCrsPath, cr);

      common.io.writeYamlFile(
        path.basename(crPath),

        cr,

        path.dirname(crPath),
      );

      crs[key] = cr;
    }
  }

  await moveCRsAndClaims(
    crs,

    org,

    claimsPath,

    resourcesPath,

    force,
  );
}

async function moveCRsAndClaims(
  crs: any,

  org: string,

  claimsPath: string,

  resourcesPath: string,

  force: boolean,
) {
  const importedResources: any = [];

  const failedImportedResources: any = [];

  for (const k of Object.keys(crs)) {
    if (cdk8s_renderer.isCatalogEntity(crs[k])) {
      log.info(
        `⚡ SKIP IMPORT: CR is a catalog entity, skipping import with kind: ${crs[k].kind} and name: ${crs[k].metadata.name}`,
      );

      continue;
    } else if (
      previousCRs[
        `${crs[k].kind}-${crs[k].metadata.annotations[common.generic.getFirestartrAnnotation('external-name')]}`
      ] &&
      !force
    ) {
      log.info(
        `⚡ SKIP IMPORT: CR already exists on disk, skipping import with kind: ${crs[k].kind} and name: ${crs[k].metadata.name}`,
      );

      continue;
    }

    try {
      log.info(
        `📝 Moving: CR with kind: ${crs[k].kind} and name: ${crs[k].metadata.name} to wet repository`,
      );

      importedResources.push(`${crs[k].kind} ${crs[k].metadata.name}`);

      common.io.moveFile(
        getCrPath(tmpRenderedCrsPath, crs[k]),

        getCrPath(resourcesPath, crs[k]),
      );

      // We only want to execute the move on claims based on parent CRs, so we're omitting child CRs
      if (!CHILD_CR_KINDS.includes(crs[k].kind)) {
        common.io.moveFile(
          getClaimPathFromCR(randomFolder, crs[k]),

          getClaimPathFromCR(claimsPath, crs[k]),
        );
      }
    } catch (e: any) {
      console.error(e);

      failedImportedResources.push(`${crs[k].kind} ${crs[k].metadata.name}`);
    }
  }

  return { importedResources, failedImportedResources };
}

async function renderCRs(data: {
  renderClaims: RenderClaims;
  deps: any;
  crs?: any;
}) {
  return await cdk8s_renderer.renderFromImports(
    data.renderClaims,

    data.crs,
  );
}

function configurePaths(
  claimsPath: string,
  resourcesPath: string,
  configPath: string,
) {
  setClaimsPath(claimsPath);

  setResourcesPath(resourcesPath);

  setConfigPath(configPath);
}

function getClaimPathFromCR(claimsBasePath: string, cr: any) {
  const mapCrsToClaims: any = {
    FirestartrGithubGroup: 'groups',

    FirestartrGithubRepository: 'components',

    FirestartrGithubMembership: 'users',

    // common.io.writeClaim derives OrgSettingsClaim -> orgsettingss.
    FirestartrGithubOrganizationSettings: 'orgsettingss',
  };

  const claimRef =
    `${cr.metadata.annotations['firestartr.dev/claim-ref']}.yaml`.toLowerCase();

  return path.join(
    claimsBasePath,

    mapCrsToClaims[cr.kind],

    claimRef.replace(/^[^/]+\//, ''),
  );
}

function getCrPath(crsBasePath: string, cr: any) {
  return path.join(
    crsBasePath,

    `${cr.kind}.${cr.metadata.name}.yaml`,
  );
}

async function getDataFromKinds(
  org: string,
  filters: CollectionFilter[] = [],
  needsReImport: boolean,
): Promise<{
  renderClaims: RenderClaims;
  deps: any;
  postRender: { [key: string]: Function[] };
}> {
  const data: any = {};

  await Promise.all([
    importGithubMemberships(org, filters, needsReImport).then(
      (memberships: any[]) => (data['memberships'] = memberships),
    ),

    importGithubGroups(org, filters, needsReImport).then(
      (groups: any[]) => (data['groups'] = groups),
    ),

    importGithubRepositories(org, filters, needsReImport).then(
      (repos: any[]) => (data['repos'] = repos),
    ),

    importGithubOrgSettings(org, filters, needsReImport).then(
      (orgSettings: any[]) => (data['orgSettings'] = orgSettings),
    ),
  ]);

  const renderClaims: RenderClaims = {};

  const deps: any = {};

  const postRender: any = {};

  for (const repo of data['repos']) {
    renderClaims[`ComponentClaim-${repo.renderClaim.claim.name}`] =
      repo.renderClaim;

    deps[`FirestartrGithubRepository-${repo.renderClaim.claim.name}`] =
      repo.deps;

    postRender[`FirestartrGithubRepository-${repo.renderClaim.claim.name}`] =
      repo.postRenderFunctions;
  }

  for (const group of data['groups']) {
    renderClaims[`GroupClaim-${group.renderClaim.claim.name}`] =
      group.renderClaim;

    deps[`FirestartrGithubGroup-${group.renderClaim.claim.name}`] = group.deps;

    postRender[`FirestartrGithubGroup-${group.renderClaim.claim.name}`] =
      group.postRenderFunctions;
  }

  for (const membership of data['memberships']) {
    renderClaims[`UserClaim-${membership.renderClaim.claim.name}`] =
      membership.renderClaim;

    deps[`FirestartrGithubMembership-${membership.renderClaim.claim.name}`] =
      membership.deps;

    postRender[
      `FirestartrGithubMembership-${membership.renderClaim.claim.name}`
    ] = membership.postRenderFunctions;
  }

  for (const orgSettings of data['orgSettings']) {
    renderClaims[`OrgSettingsClaim-${orgSettings.renderClaim.claim.name}`] =
      orgSettings.renderClaim;

    deps[
      `FirestartrGithubOrganizationSettings-${orgSettings.renderClaim.claim.name}`
    ] = orgSettings.deps;

    postRender[
      `FirestartrGithubOrganizationSettings-${orgSettings.renderClaim.claim.name}`
    ] = orgSettings.postRenderFunctions;
  }

  return { renderClaims, deps: deps, postRender: postRender };
}

async function importGithubGroups(
  org: string,
  filters: CollectionFilter[] = [],
  needsReImport: boolean,
) {
  const groups: any[] = [];

  const collectionGroupsDecanter = new GroupCollectionGithubDecanter({}, org);

  const collection = await collectionGroupsDecanter.collection(filters);

  for (const group of collection) {
    group.needsReImport = needsReImport;

    await group.gather();

    await group.decant();

    group.render();

    group.postRender();

    groups.push(await group.adapt());
  }

  return groups;
}

async function importGithubRepositories(
  org: string,
  filters: CollectionFilter[] = [],
  needsReImport: boolean,
) {
  const repos: any[] = [];

  const collectionGroupsDecanter = new RepoCollectionGithubDecanter({}, org);

  const collection = await collectionGroupsDecanter.collection(filters);

  for (const repo of collection) {
    repo.needsReImport = needsReImport;

    await repo.gather();

    await repo.decant();

    repos.push(await repo.adapt());

    repo.render();
  }

  return repos;
}

async function importGithubMemberships(
  org: string,
  filters: CollectionFilter[] = [],
  needsReImport: boolean,
) {
  const memberships: any[] = [];

  const memberColletion = new MemberCollectionGithubDecanter({}, org);

  const collection = await memberColletion.collection(filters);

  for (const member of collection) {
    member.needsReImport = needsReImport;

    await member.gather();

    await member.decant();

    memberships.push(await member.adapt());

    member.render();
  }

  return memberships;
}

async function importGithubOrgSettings(
  org: string,
  filters: CollectionFilter[] = [],
  needsReImport: boolean,
) {
  const orgSettingsList: any[] = [];

  const orgSettingsCollection = new OrgSettingsCollectionGithubDecanter(
    {},
    org,
  );

  const collection = await orgSettingsCollection.collection(filters);

  for (const orgSettings of collection) {
    orgSettings.needsReImport = needsReImport;

    await orgSettings.gather();

    await orgSettings.decant();

    orgSettingsList.push(await orgSettings.adapt());

    orgSettings.render();
  }

  return orgSettingsList;
}

export async function getPreviousCrs(crsPath: string) {}

export default { importGithubGitopsRepository };
