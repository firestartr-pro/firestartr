import github from 'github';
import common from 'catalog_common';
import { resolve } from '../resolver';
import { addPlanStatusCheck, getItemByItemPath, getSecret } from '../ctl';
import { runTerraformProvisioner } from 'terraform_provisioner';
import { buildProvisionerContext } from '../tfworkspaces/process-operation';
import { publishPlan } from '../user-feedback-ops/user-feedback-ops';
import { extractErrorDetails } from '../utils';
import ghProvisioner from 'gh_provisioner';
import { getKindFromPlural, getPluralFromKind } from '../definitions';

interface PlanOptions {
  prNumber: number;
  repo: string;
  owner: string;
  namespace: string;
  ref: string;
}

interface PlanContext extends PlanOptions {
  baseSha?: string;
  baseResourceByItemPath: Map<string, any | null>;
  fileContentByFilename: Map<string, string>;
  prFileStatusByItemPath: Map<string, string>;
  prResourceByItemPath: Map<string, any>;
}

enum FileStatus {
  DELETED = 'removed',
  ADDED = 'added',
  MODIFIED = 'modified',
  RENAMED = 'renamed',
  COPIED = 'copied',
  CHANGED = 'changed',
  UNCHANGED = 'unchanged',
}

const TERRAFORM_WORKSPACE_KIND = 'FirestartrTerraformWorkspace';

const GITHUB_RESOURCE_KINDS = [
  'FirestartrGithubGroup',
  'FirestartrGithubMembership',
  'FirestartrGithubRepository',
  'FirestartrGithubRepositoryFeature',
  'FirestartrGithubRepositorySecretsSection',
  'FirestartrGithubOrgWebhook',
  'FirestartrGithubOrganizationSettings',
  'FirestartrGithubOrganizationVariableSection',
];

const GITHUB_REPOSITORY_DEPENDENT_KINDS = [
  'FirestartrGithubRepositoryFeature',
  'FirestartrGithubRepositorySecretsSection',
];

const SUPPORTED_RESOURCE_KINDS = [
  TERRAFORM_WORKSPACE_KIND,
  ...GITHUB_RESOURCE_KINDS,
];

const SUMMARY_FAILURE_MAX_LENGTH = 160;
const SUMMARY_DETAIL_MAX_ITEMS = 20;

interface PlanResult {
  filename: string;
  kind?: string;
  name?: string;
  skipped?: boolean;
  success: boolean;
  message: string;
}

function fDebug(message: string, level: 'info' | 'error' | 'warn' = 'info') {
  console.log(JSON.stringify({ message, level }));
}

export async function pullRequestPlan(opts: PlanOptions) {
  const { repo, owner, prNumber } = opts;
  const pull = `${owner}/${repo}#${prNumber}`;

  try {
    fDebug(`Starting plan for ${pull}`, 'info');

    await addPlanStatusCheck(pull, 'Plan in progress...');

    fDebug(`Getting PR ${prNumber} in ${repo}`, 'info');

    const resp = await github.pulls.getPrFiles(prNumber, repo, owner);

    const { data } = resp;

    if (data.length === 0) {
      throw new Error(`No data found for PR ${opts.prNumber} in ${opts.repo}`);
    }

    const planContext: PlanContext = {
      ...opts,
      baseResourceByItemPath: new Map(),
      fileContentByFilename: new Map(),
      prFileStatusByItemPath: new Map(),
      prResourceByItemPath: new Map(),
    };

    await indexPrResources(data, planContext);

    const results: PlanResult[] = [];

    for (const file of data) {
      results.push(await planFile(file, planContext));
    }

    const plannedResults = results.filter((result) => !result.skipped);

    if (plannedResults.length === 0) {
      throw new Error(
        `No supported Firestartr resources found in PR ${opts.prNumber} in ${opts.repo}`,
      );
    }

    const failedResults = plannedResults.filter((result) => !result.success);
    const summary = buildSummary(results);

    await addPlanStatusCheck(
      pull,
      summary,
      'completed',
      failedResults.length > 0,
    );
  } catch (e: any) {
    console.error(e);
    const { output: message } = extractErrorDetails(e);

    fDebug(`Error: ${message}`, 'error');

    await addPlanStatusCheck(pull, message, 'completed', true);
  }
}

async function planFile(file: any, opts: PlanContext): Promise<PlanResult> {
  const { repo, owner, prNumber } = opts;
  const { filename, status } = file;

  let cr: any;

  try {
    if (!isYamlFile(filename)) {
      return skippedResult(filename, 'Not a YAML file');
    }

    if (!isTrackedFileStatus(status)) {
      return skippedResult(filename, `Unsupported file status ${status}`);
    }

    fDebug(`Getting content for ${filename} in ${repo}`);

    const content = await getFileContent(filename, status, opts);
    cr = common.io.fromYaml(content);

    if (!cr || !cr.kind) {
      const message = `Missing Kubernetes kind in ${filename}`;
      await publishPlan(
        fallbackPlanResource(filename),
        message,
        prNumber,
        repo,
        owner,
        false,
        getCommandByStatus(status),
        filename,
      );

      return {
        filename,
        kind: 'UnknownKind',
        name: filename,
        success: false,
        message,
      };
    }

    if (!SUPPORTED_RESOURCE_KINDS.includes(cr.kind)) {
      return skippedResult(filename, `Unsupported kind ${cr.kind}`);
    }

    const resourceName = getResourceName(cr);

    if (!resourceName) {
      const message = `Missing metadata.name or metadata.generateName in ${filename}`;
      await publishPlan(
        withFallbackResourceName(cr, filename),
        message,
        prNumber,
        repo,
        owner,
        false,
        getCommandByStatus(status),
        filename,
      );

      return {
        filename,
        kind: cr.kind,
        name: filename,
        success: false,
        message,
      };
    }

    const skipReason = await getPlanSkipReason(cr, status, opts);

    if (skipReason) {
      await publishPlan(
        cr,
        skipReason,
        prNumber,
        repo,
        owner,
        true,
        `${getCommandByStatus(status)}-skipped`,
        filename,
      );

      return {
        filename,
        kind: cr.kind,
        name: resourceName,
        skipped: true,
        success: true,
        message: skipReason,
      };
    }

    const output = isGithubResourceKind(cr.kind)
      ? await planGithubResource(cr, status, opts)
      : await planTerraformWorkspace(cr, status, opts);

    await publishPlan(
      cr,
      output,
      prNumber,
      repo,
      owner,
      true,
      getCommandByStatus(status),
      filename,
    );

    return {
      filename,
      kind: cr.kind,
      name: resourceName,
      success: true,
      message: output,
    };
  } catch (e: any) {
    console.error(e);
    const { output: message } = extractErrorDetails(e);

    await publishPlan(
      cr && cr.kind ? cr : fallbackPlanResource(filename),
      message,
      prNumber,
      repo,
      owner,
      false,
      getSafeCommandByStatus(status),
      filename,
    );

    return {
      filename,
      kind: cr?.kind,
      name: cr ? getResourceName(cr, filename) : undefined,
      success: false,
      message,
    };
  }
}

async function getFileContent(
  filename: string,
  status: string,
  opts: PlanContext,
) {
  const { repo, owner, prNumber, ref } = opts;

  const cachedContent = opts.fileContentByFilename.get(filename);

  if (cachedContent !== undefined) return cachedContent;

  let content: string;

  if (status === FileStatus.DELETED) {
    if (!opts.baseSha) {
      opts.baseSha = await github.pulls.getPrBaseSHA(prNumber, repo, owner);
    }

    content = await github.repo.getContent(filename, repo, owner, opts.baseSha);
    opts.fileContentByFilename.set(filename, content);

    return content;
  }

  if (
    status === FileStatus.ADDED ||
    status === FileStatus.MODIFIED ||
    status === FileStatus.RENAMED ||
    status === FileStatus.COPIED ||
    status === FileStatus.CHANGED
  ) {
    content = await github.repo.getContent(filename, repo, owner, ref);
    opts.fileContentByFilename.set(filename, content);

    return content;
  }

  throw new Error(
    `Unknown status ${status} for file ${filename} in PR ${prNumber} in ${repo}`,
  );
}

async function planTerraformWorkspace(
  cr: any,
  status: string,
  opts: PlanContext,
) {
  fDebug('Resolving references');
  const deps: any = await resolve(
    cr,
    getPrAwareItemByItemPath(opts, status),
    getSecret,
    opts.namespace,
  );

  fDebug('Building context');
  const ctx = await buildProvisionerContext(cr, deps);

  fDebug('Context built');
  const command = getCommandByStatus(status);

  fDebug('Running terraform provisioner');
  const tfOutput: string = await runTerraformProvisioner(
    ctx,
    command,
    undefined,
  );

  fDebug('Terraform provisioner finished');
  return tfOutput;
}

async function planGithubResource(cr: any, status: string, opts: PlanContext) {
  fDebug('Resolving references');
  const deps: any = await resolve(
    cr,
    getPrAwareItemByItemPath(opts, status),
    getSecret,
    opts.namespace,
  );

  fDebug('Running GitHub provisioner plan');
  return await ghProvisioner.runGhProvisioner(
    {
      mainCr: cr,
      deps,
    },
    getGithubPlanOptionsByStatus(status),
  );
}

async function indexPrResources(files: any[], opts: PlanContext) {
  for (const file of files) {
    if (!isYamlFile(file.filename)) continue;

    if (!isTrackedFileStatus(file.status)) continue;

    try {
      const content = await getFileContent(file.filename, file.status, opts);
      const cr = common.io.fromYaml(content);
      const itemPath = getCrItemPath(cr, opts.namespace);

      if (itemPath) {
        opts.prFileStatusByItemPath.set(itemPath, file.status);

        if (file.status !== FileStatus.DELETED) {
          opts.prResourceByItemPath.set(itemPath, cr);
        }
      }
    } catch {
      // Invalid YAML or unsupported resources are reported by planFile.
    }
  }
}

async function getPlanSkipReason(
  cr: any,
  status: string,
  opts: PlanContext,
): Promise<string | undefined> {
  if (!isPrRefStatus(status)) return undefined;

  if (!GITHUB_REPOSITORY_DEPENDENT_KINDS.includes(cr.kind)) return undefined;

  const repositoryRef = cr.spec?.repositoryTarget?.ref;

  if (
    repositoryRef?.kind !== 'FirestartrGithubRepository' ||
    !repositoryRef.name
  ) {
    return undefined;
  }

  const namespace = cr.metadata?.namespace || opts.namespace;
  const repositoryItemPath = `${namespace}/${getPluralFromKind(repositoryRef.kind)}/${repositoryRef.name}`;

  if (
    opts.prFileStatusByItemPath.get(repositoryItemPath) !== FileStatus.ADDED
  ) {
    return undefined;
  }

  const baseRepository = await getBaseGithubResource(repositoryItemPath, opts);

  if (baseRepository) return undefined;

  return (
    `Skipped plan: ${cr.kind}/${getResourceName(cr)} targets ` +
    `${repositoryRef.kind}/${repositoryRef.name}, which is created in this PR. ` +
    'The repository feature and secrets section can only be planned after the repository exists.'
  );
}

function getPrAwareItemByItemPath(opts: PlanContext, currentStatus: string) {
  return async (itemPath: string, apiGroup?: string, apiVersion?: string) => {
    if (opts.prFileStatusByItemPath.get(itemPath) === FileStatus.DELETED) {
      if (currentStatus === FileStatus.DELETED) {
        return getBaseGithubResource(itemPath, opts);
      }

      return undefined;
    }

    const prResource = opts.prResourceByItemPath.get(itemPath);

    if (prResource) return prResource;

    const baseResource = await getBaseGithubResource(itemPath, opts);

    if (baseResource) return baseResource;

    return getItemByItemPath(itemPath, apiGroup, apiVersion);
  };
}

async function getBaseGithubResource(itemPath: string, opts: PlanContext) {
  if (opts.baseResourceByItemPath.has(itemPath)) {
    return opts.baseResourceByItemPath.get(itemPath) ?? undefined;
  }

  const resourceFile = getGithubResourceFilename(itemPath);

  if (!resourceFile) return undefined;

  if (!opts.baseSha) {
    opts.baseSha = await github.pulls.getPrBaseSHA(
      opts.prNumber,
      opts.repo,
      opts.owner,
    );
  }

  try {
    const content = await github.repo.getContent(
      resourceFile,
      opts.repo,
      opts.owner,
      opts.baseSha,
    );
    const cr = common.io.fromYaml(content);

    opts.baseResourceByItemPath.set(itemPath, cr);

    return cr;
  } catch (e: any) {
    if (e.status === 404 || e.message?.includes('Not Found')) {
      opts.baseResourceByItemPath.set(itemPath, null);

      return undefined;
    }

    throw e;
  }
}

function getGithubResourceFilename(itemPath: string) {
  const [, plural, name] = itemPath.match(/[^/]+\/([^/]+)\/([^/]+)$/) || [];
  const kind = getKindFromPlural(plural);

  if (!kind || !GITHUB_RESOURCE_KINDS.includes(kind)) return undefined;

  return `${kind}.${name}.yaml`;
}

function getCrItemPath(cr: any, namespace: string) {
  const plural = cr?.kind ? getPluralFromKind(cr.kind) : undefined;
  const name = getResourceName(cr);

  if (!plural || !name) return undefined;

  return `${cr.metadata?.namespace || namespace}/${plural}/${name}`;
}

function isPrRefStatus(status: string) {
  return (
    status === FileStatus.ADDED ||
    status === FileStatus.MODIFIED ||
    status === FileStatus.RENAMED ||
    status === FileStatus.COPIED ||
    status === FileStatus.CHANGED
  );
}

function isTrackedFileStatus(status: string) {
  return isPrRefStatus(status) || status === FileStatus.DELETED;
}

function getGithubPlanOptionsByStatus(status: string) {
  switch (status) {
    case FileStatus.MODIFIED:
    case FileStatus.ADDED:
    case FileStatus.RENAMED:
    case FileStatus.COPIED:
    case FileStatus.CHANGED:
      return { plan: true };
    case FileStatus.DELETED:
      return { planDestroy: true };
    default:
      throw new Error(`Unknown status: ${status}`);
  }
}

function skippedResult(filename: string, message: string): PlanResult {
  return {
    filename,
    skipped: true,
    success: true,
    message,
  };
}

function isGithubResourceKind(kind: string) {
  return GITHUB_RESOURCE_KINDS.includes(kind);
}

function isYamlFile(filename: string) {
  return filename.endsWith('.yaml') || filename.endsWith('.yml');
}

function getResourceName(cr: any, fallbackName?: string) {
  return cr.metadata?.name || cr.metadata?.generateName || fallbackName;
}

function withFallbackResourceName(cr: any, filename: string) {
  return {
    ...cr,
    metadata: {
      ...cr.metadata,
      generateName: cr.metadata?.generateName || filename,
    },
  };
}

function fallbackPlanResource(filename: string) {
  return {
    kind: 'UnknownKind',
    metadata: {
      name: filename,
    },
  };
}

function buildSummary(results: PlanResult[]) {
  const planned = results.filter((result) => !result.skipped);
  const failed = planned.filter((result) => !result.success);
  const skipped = results.filter((result) => result.skipped);
  const summaryLines = [
    failed.length > 0 ? 'Plan failed' : 'Plan completed',
    `Planned resources: ${planned.length}`,
    `Failed resources: ${failed.length}`,
    `Skipped files: ${skipped.length}`,
  ];

  const detailLines = [];

  for (const result of planned) {
    const resource = [result.kind, result.name].filter(Boolean).join('/');
    const status = result.success ? 'success' : 'failed';
    const details = result.success
      ? ''
      : ` (${summarizeFailure(result.message)})`;
    detailLines.push(`- ${status}: ${resource || result.filename}${details}`);
  }

  for (const result of skipped) {
    const resource = [result.kind, result.name].filter(Boolean).join('/');
    detailLines.push(
      `- skipped: ${resource || result.filename} (${result.message})`,
    );
  }

  const lines = [...summaryLines, ''];
  lines.push(...detailLines.slice(0, SUMMARY_DETAIL_MAX_ITEMS));

  const omittedDetails = detailLines.length - SUMMARY_DETAIL_MAX_ITEMS;

  if (omittedDetails > 0) {
    lines.push(`- omitted detail lines: ${omittedDetails}`);
  }

  lines.push('', ...summaryLines);

  return lines.join('\n');
}

function summarizeFailure(message: string) {
  const [firstLine = ''] = message.split('\n');

  if (firstLine.length <= SUMMARY_FAILURE_MAX_LENGTH) {
    return firstLine;
  }

  return `${firstLine.slice(0, SUMMARY_FAILURE_MAX_LENGTH - 3)}...`;
}

function getCommandByStatus(status: string): string {
  switch (status) {
    case FileStatus.MODIFIED:
    case FileStatus.ADDED:
    case FileStatus.RENAMED:
    case FileStatus.COPIED:
    case FileStatus.CHANGED:
      return 'plan';
    case FileStatus.DELETED:
      return 'plan-destroy';
    default:
      throw new Error(`Unknown status: ${status}`);
  }
}

function getSafeCommandByStatus(status: string): string {
  try {
    return getCommandByStatus(status);
  } catch {
    return 'plan';
  }
}
