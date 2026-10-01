import { Construct } from 'constructs';
import { ApiObject } from 'cdk8s';
import { setRenderedClaim } from '../refresolver';
import { RenderClaimKey, RenderClaims, RenderedCrMap } from './types';
import { IRenameResult } from '../loader/loader';
import { sortKinds } from './claims-sorter';
import {
  AllowedProviders,
  getConfiguredProvider,
  getDefaultBranch,
  getPath,
  getRepositoryUrl,
} from '../config';
import { extractPatches } from './patches-extractor';
import { getPreviousCRfromClaim } from './previous-crs-extractor';
import { ICustomResourcePatch } from '../patches';
import { IRenderClaimResult } from './interfaces';
import { BaseChart } from '../charts/base';
import * as charts from '../charts';
import { IApiDefinition } from '../claims/base/component';
import { sanitizeApiEntityName } from '../utils/claimUtils';
import * as path from 'path';
import * as fs from 'fs';

import log from '../logger';

function normalizeProvidesApis(
  providesApis: IApiDefinition[] | Record<string, IApiDefinition> | undefined,
): IApiDefinition[] {
  if (!providesApis) return [];

  if (Array.isArray(providesApis)) {
    return providesApis;
  }

  return Object.values(providesApis);
}

export async function renderClaims(
  catalogScope: Construct,

  firestartrScope: Construct,

  data: {
    renderClaims: RenderClaims;

    crs: any;

    renames?: IRenameResult[];
  },
): Promise<RenderedCrMap> {
  const result: RenderedCrMap = {};

  const { renderClaims, crs } = data;

  const sortedKinds = sortKinds(
    [
      'UserClaim',
      'GroupClaim',
      'ComponentClaim',
      'DomainClaim',
      'SystemClaim',
      'SecretsClaim',
      'TFWorkspaceClaim',
      'ArgoDeployClaim',
      'OrgWebhookClaim',
      'OrgSettingsClaim',
    ],
    renderClaims,
  );

  for (const renderClaims of sortedKinds) {
    for (const claimKey of Object.keys(renderClaims)) {
      const claim = renderClaims[claimKey as RenderClaimKey].claim;

      const configuredProvider = getConfiguredProvider().toString();

      let providers = Object.keys(claim.providers);

      if (configuredProvider !== AllowedProviders.all.toString()) {
        providers = providers.filter(
          (provider: string) => provider === configuredProvider,
        );
      }

      const expectedKind =
        claim.kind === 'OrgSettingsClaim'
          ? 'FirestartrGithubOrganizationSettings'
          : undefined;
      const previousCR = getPreviousCRfromClaim(claim, crs, expectedKind);

      const variableSectionPreviousCR =
        claim.kind === 'OrgSettingsClaim'
          ? getPreviousCRfromClaim(
              claim,
              crs,
              'FirestartrGithubOrganizationVariableSection',
            )
          : false;

      const patches = await extractPatches(
        renderClaims[claimKey as RenderClaimKey],
        previousCR,
        crs,
      );

      let variableSectionPatches: ICustomResourcePatch[] | undefined =
        undefined;
      if (claim.kind === 'OrgSettingsClaim') {
        variableSectionPatches = await extractPatches(
          renderClaims[claimKey as RenderClaimKey],
          variableSectionPreviousCR,
          crs,
        );
      }

      if (!previousCR) {
        log.debug(
          `No CR found for claim ${claimKey}, it will be rendered from scratch`,
        );
      }

      const claimPath: string | undefined =
        renderClaims[claimKey as RenderClaimKey].claimPath;

      const { firestartrEntity, extraCharts, catalogEntity } =
        await renderClaim(
          catalogScope,
          firestartrScope,
          claim,
          patches,
          previousCR,
          claimPath,
          variableSectionPreviousCR,
          variableSectionPatches,
          crs,
        );

      if (catalogEntity) {
        result[`${catalogEntity.kind}-${catalogEntity.metadata.name}`] =
          catalogEntity.toJson();
      }

      for (const extraChart of extraCharts) {
        const { claim, chart } = extraChart;

        setRenderedClaim(claim, chart.toJson());

        result[`${chart.kind}-${chart.metadata.name}`] = chart.toJson();
      }

      /**
       * If there is no provider don't store the CR in the map
       */
      if (!firestartrEntity) continue;

      const firestartrEntityJson = firestartrEntity.toJson();

      setRenderedClaim(claim, firestartrEntityJson);

      if (
        !firestartrEntityJson.metadata.annotations ||
        !firestartrEntityJson.metadata.name
      )
        throw firestartrEntityJson;

      if (
        result[`${firestartrEntity.kind}-${firestartrEntityJson.metadata.name}`]
      ) {
        throw new Error(
          `Duplicate CR found for ${firestartrEntity.kind}-${firestartrEntityJson.metadata.name}`,
        );
      }

      result[`${firestartrEntity.kind}-${firestartrEntityJson.metadata.name}`] =
        firestartrEntityJson;
    }
  }

  return result;
}

export async function renderClaim(
  catalogScope: Construct,

  firestartrScope: Construct,

  claim: any,

  patches: ICustomResourcePatch[],

  previousCR: any | null = null,

  claimPath?: string,

  variableSectionPreviousCR: any | false = false,

  variableSectionPatches?: ICustomResourcePatch[],

  crs?: any,
): Promise<IRenderClaimResult> {
  let catalogEntity: BaseChart | undefined = undefined;
  let firestartrEntity: BaseChart | undefined = undefined;
  const extraCharts: {
    claim: {
      kind: string;
      name: string;
    };
    chart: ApiObject;
  }[] = [];

  const isVariant =
    claim.annotations?.['firestartr.dev/variant-of'] !== undefined;

  const chartId = isVariant
    ? `${claim.kind}-${claim.name}.variant`.toLowerCase()
    : `${claim.kind}-${claim.name}`.toLowerCase();

  let firestartrId: string | null = null;

  if (previousCR) {
    firestartrId = previousCR?.spec?.firestartr?.tfStateKey || null;
  }

  const renderPatches = patches.filter((patch: any) => !patch.isPostPatch);
  const postPatches = patches.filter((patch: any) => patch.isPostPatch);

  const provider = getConfiguredProvider();

  const loadGithub =
    (provider === AllowedProviders.all ||
      provider === AllowedProviders.github) &&
    'github' in claim.providers;

  const loadCatalog =
    provider === AllowedProviders.all || provider === AllowedProviders.catalog;

  switch (claim.kind) {
    case 'DomainClaim':
      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogDomainChart(
          catalogScope,
          `catalog-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      break;

    case 'SystemClaim':
      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogSystemChart(
          catalogScope,
          `catalog-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      break;

    case 'GroupClaim':
      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogGroupChart(
          catalogScope,
          `catalog-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      if (loadGithub) {
        firestartrEntity = new charts.default.GithubGroupChart(
          firestartrScope,
          `github-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }

      break;

    case 'UserClaim':
      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogUserChart(
          catalogScope,
          chartId,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      if (loadGithub) {
        firestartrEntity = new charts.default.GithubMembershipChart(
          firestartrScope,
          `github-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }

      break;

    case 'ComponentClaim':
      if (loadGithub) {
        firestartrEntity = new charts.default.GithubRepositoryChart(
          firestartrScope,
          `github-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
        firestartrEntity.set('previousCRs', crs);
      }

      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogComponentChart(
          catalogScope,
          chartId,
          firestartrId,
          claim,
          renderPatches,
        );

        const githubProvider = claim.providers?.github;
        const org = githubProvider?.org;
        const repoName = githubProvider?.name;
        const defaultBranch =
          githubProvider?.branchStrategy?.defaultBranch || 'main';

        for (const apiDefinition of normalizeProvidesApis(claim.providesApis)) {
          if (
            !org ||
            !repoName ||
            !apiDefinition?.definitionfile ||
            !apiDefinition?.name
          ) {
            log.warn(
              `Skipping API generation for component ${claim.name} due to missing github provider fields or API definition data`,
            );
            continue;
          }

          const definitionFilePath = String(
            apiDefinition.definitionfile,
          ).replace(/^\/+/, '');
          const encodedDefinitionFilePath = definitionFilePath
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
          const definitionUrl = `https://github.com/${org}/${repoName}/blob/${defaultBranch}/${encodedDefinitionFilePath}`;

          const sanitizedApiName = sanitizeApiEntityName(apiDefinition.name);
          const repoUrl: string | undefined = getRepositoryUrl();
          const apiAnnotations: Record<string, string> = {
            ...(claim.annotations || {}),
            title: apiDefinition.name,
          };
          if (repoUrl && claimPath) {
            const repoRoot = path.dirname(getPath('claims'));
            const relativePath = path
              .relative(repoRoot, claimPath)
              .split(path.sep)
              .map((segment) => encodeURIComponent(segment))
              .join('/');
            apiAnnotations['backstage.io/edit-url'] =
              `${repoUrl}/blob/${getDefaultBranch()}/${relativePath}`;
          }

          const apiChart = new charts.default.CatalogApiChart(
            catalogScope,
            `${chartId}-api-${sanitizedApiName}`,
            firestartrId,
            {
              name: sanitizedApiName,
              type: apiDefinition.type,
              lifecycle: claim.lifecycle,
              owner: claim.owner,
              system: claim.system,
              definitionUrl,
              annotations: apiAnnotations,
            },
            [],
          );

          await apiChart.render();
          const apiObject = await apiChart.postRenderer([]);
          extraCharts.push({
            claim: {
              kind: 'API',
              name: sanitizedApiName,
            },
            chart: apiObject,
          });
        }
      }
      break;

    case 'TFWorkspaceClaim':
      if (
        claim.providers.terraform &&
        (provider === AllowedProviders.terraform ||
          provider === AllowedProviders.all)
      ) {
        firestartrEntity = new charts.default.TFWorkspaceChart(
          firestartrScope,
          `terraform-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }

      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogTFWorkspaceChart(
          catalogScope,
          chartId,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      break;

    case 'SecretsClaim':
      if (
        claim.providers.external_secrets &&
        (provider === AllowedProviders.externalSecrets ||
          provider === AllowedProviders.terraform ||
          provider === AllowedProviders.all)
      ) {
        firestartrEntity = new charts.default.SecretsChart(
          firestartrScope,
          chartId,
          firestartrId,
          claim,
          [],
        );
      }

      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogSecretsChart(
          catalogScope,
          chartId,
          firestartrId,
          claim,
          [],
        );
      }
      break;

    case 'ArgoDeployClaim':
      if (
        claim.providers.argocd &&
        (provider === AllowedProviders.argocd ||
          provider === AllowedProviders.all)
      ) {
        firestartrEntity = new charts.default.ArgoDeployChart(
          firestartrScope,
          `argocd-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }

      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogArgoDeployChart(
          catalogScope,
          chartId,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      break;

    case 'OrgWebhookClaim':
      if (loadCatalog) {
        catalogEntity = new charts.default.CatalogOrgWebhookChart(
          catalogScope,
          `catalog-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      if (loadGithub) {
        firestartrEntity = new charts.default.GithubOrgWebhookChart(
          firestartrScope,
          `github-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );
      }
      break;

    case 'OrgSettingsClaim':
      if (loadGithub) {
        firestartrEntity = new charts.default.GithubOrgSettingsChart(
          firestartrScope,
          `github-${chartId}`,
          firestartrId,
          claim,
          renderPatches,
        );

        const variableSectionFirestartrId = variableSectionPreviousCR
          ? variableSectionPreviousCR.spec?.firestartr?.tfStateKey
          : firestartrId
            ? `${firestartrId}-variables`
            : null;

        const vsRenderPatches = variableSectionPatches
          ? variableSectionPatches.filter((patch: any) => !patch.isPostPatch)
          : renderPatches;
        const vsPostPatches = variableSectionPatches
          ? variableSectionPatches.filter((patch: any) => patch.isPostPatch)
          : postPatches;

        const variableSectionChart =
          new charts.default.GithubOrgVariableSectionChart(
            firestartrScope,
            `github-variables-${chartId}`,
            variableSectionFirestartrId,
            claim,
            vsRenderPatches,
          );

        await variableSectionChart.render();
        const variableSectionObject =
          await variableSectionChart.postRenderer(vsPostPatches);

        extraCharts.push({
          claim: {
            kind: claim.kind,
            name: `${claim.name}-variable-section`,
          },
          chart: variableSectionObject,
        });
      }
      break;

    default:
      console.error(`Unknown claim kind: ${claim.kind}`);

      break;
  }

  /**
   * There is the possibility to only render the catalog entity, but not the other way around
   */
  if (!catalogEntity) {
    //throw new Error(`Unable to render claim ${claim.kind}-${claim.name}`);
  }

  /*
   *
   * Render phase
   *
   */
  const [catalogChart, firestartrEntityChart] = await Promise.all([
    catalogEntity ? catalogEntity.render() : Promise.resolve(undefined),

    firestartrEntity?.render(),
  ]);

  /*
   *
   * Post render phase (and return)
   *
   */
  return {
    catalogEntity: catalogChart
      ? await catalogChart.postRenderer(postPatches)
      : undefined,

    firestartrEntity: await (firestartrEntityChart
      ? firestartrEntityChart.postRenderer(postPatches)
      : undefined),

    extraCharts: [
      ...((await firestartrEntity?.extraCharts()) || []),
      ...extraCharts,
    ],
  };
}

export function renameVariantCrFiles(
  outputDir: string,
  renderedMap: RenderedCrMap,
): void {
  for (const cr of Object.values(renderedMap)) {
    const crJson = (cr as any).toJson ? (cr as any).toJson() : cr;
    if (
      crJson.metadata?.annotations?.['firestartr.dev/variant-of'] &&
      crJson.kind &&
      crJson.metadata?.name
    ) {
      const oldPath = path.join(
        outputDir,
        `${crJson.kind}.${crJson.metadata.name}.yaml`,
      );
      const newPath = path.join(
        outputDir,
        `${crJson.kind}.${crJson.metadata.name}.variant.yaml`,
      );
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        log.info(`Renamed variant CR file: ${oldPath} -> ${newPath}`);
      }
    }
  }
}
