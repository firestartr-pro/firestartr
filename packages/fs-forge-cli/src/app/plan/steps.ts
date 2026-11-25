import { lstat, mkdir, realpath, writeFile } from 'fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'path';

import type { AppPlanResult, PlanCheck } from './types.js';
import type { OrgPlan } from '../../github/api.js';
import type { RenderOutcome, RenderedFile } from '../render/index.js';

export interface PlanStepFile {
  path: string;
  outcome: RenderOutcome;
  notes?: string[];
  /** Rendered content; omitted when outcome is `noop` or `conflict`. */
  content?: string;
}

export interface PlanRepoEntry {
  repo: string;
  baseBranch: string;
  headBranch: string;
  files: PlanStepFile[];
  prTitle?: string;
  hasChanges: boolean;
  summary: string;
}

export interface PlanStep {
  step: 1 | 2 | 3;
  parallel: boolean;
  repos: PlanRepoEntry[];
  waitFor?: string;
  satisfied: boolean;
}

export interface PlanConflict {
  repo: string;
  path: string;
  reason: string;
}

export interface AppPlanJsonOutput {
  org: string;
  app: string;
  orgPlan: OrgPlan;
  steps: PlanStep[];
  checks: PlanCheck[];
  conflicts: PlanConflict[];
  ready: boolean;
}

/** Deterministic head branch name shared by `app plan` and `app apply`. */
export function appPlanHeadBranch(app: string): string {
  return `fs-forge/app-${app}`;
}

function toPlanStepFile(file: RenderedFile): PlanStepFile {
  const base: PlanStepFile = {
    path: file.path,
    outcome: file.outcome,
    ...(file.notes && file.notes.length > 0 ? { notes: file.notes } : {}),
  };
  if (file.outcome.kind === 'create' || file.outcome.kind === 'merge') {
    return { ...base, content: file.content };
  }
  return base;
}

function buildRepoEntry(params: {
  repo: string;
  baseBranch: string;
  headBranch: string;
  files: RenderedFile[];
  prTitle: string;
}): PlanRepoEntry {
  const stepFiles = params.files.map(toPlanStepFile);
  const allNoop = stepFiles.every((f) => f.outcome.kind === 'noop');
  if (allNoop) {
    return {
      repo: params.repo,
      baseBranch: params.baseBranch,
      headBranch: params.headBranch,
      files: stepFiles,
      hasChanges: false,
      summary: 'nothing to change',
    };
  }
  return {
    repo: params.repo,
    baseBranch: params.baseBranch,
    headBranch: params.headBranch,
    files: stepFiles,
    prTitle: params.prTitle,
    hasChanges: true,
    summary: params.prTitle,
  };
}

export function buildPlanSteps(result: AppPlanResult): PlanStep[] {
  const { context, files } = result;
  const app = context.inputs.app;
  const org = context.org;
  const headBranch = appPlanHeadBranch(app);
  const { defaultBranches } = context;

  const claimsEntry = buildRepoEntry({
    repo: `${org}/${context.claimsRepoName}`,
    baseBranch: defaultBranches.claims,
    headBranch,
    files: files.claims,
    prTitle: `feat(app): configure ${app} claims`,
  });

  const dotFirestartrEntry = buildRepoEntry({
    repo: `${org}/.firestartr`,
    baseBranch: defaultBranches.dotFirestartr,
    headBranch,
    files: files.dotFirestartr,
    prTitle: `feat(app): register ${app} in .firestartr`,
  });

  const stateAppEntry = buildRepoEntry({
    repo: `${org}/app-${app}`,
    baseBranch: defaultBranches.stateApp,
    headBranch,
    files: files.stateApp,
    prTitle: `feat(app): scaffold ${app} targets`,
  });

  const stateArgocdEntry = buildRepoEntry({
    repo: `${org}/state-argocd`,
    baseBranch: defaultBranches.stateArgocd,
    headBranch,
    files: files.stateArgocd,
    prTitle: `feat(app): configure ${app} ArgoCD manifests`,
  });

  const serviceEntry = buildRepoEntry({
    repo: `${context.serviceRepoOwner}/${context.serviceRepoName}`,
    baseBranch: defaultBranches.service,
    headBranch,
    files: files.service,
    prTitle: `feat(app): configure ${app} dispatches`,
  });

  const step1Satisfied = !claimsEntry.hasChanges;
  const step2Repos = [dotFirestartrEntry, stateAppEntry, stateArgocdEntry];
  const step2Satisfied = step2Repos.every((r) => !r.hasChanges);
  const step3Satisfied = !serviceEntry.hasChanges;

  return [
    {
      step: 1,
      parallel: false,
      repos: [claimsEntry],
      ...(step1Satisfied
        ? {}
        : { waitFor: 'merged, checks green, provisioned' }),
      satisfied: step1Satisfied,
    },
    {
      step: 2,
      parallel: true,
      repos: step2Repos,
      ...(step2Satisfied ? {} : { waitFor: 'all three merged' }),
      satisfied: step2Satisfied,
    },
    {
      step: 3,
      parallel: false,
      repos: [serviceEntry],
      satisfied: step3Satisfied,
    },
  ];
}

export function collectPlanConflicts(steps: PlanStep[]): PlanConflict[] {
  const conflicts: PlanConflict[] = [];
  for (const step of steps) {
    for (const repoEntry of step.repos) {
      for (const file of repoEntry.files) {
        if (file.outcome.kind === 'conflict') {
          conflicts.push({
            repo: repoEntry.repo,
            path: file.path,
            reason: file.outcome.reason,
          });
        }
      }
    }
  }
  return conflicts;
}

export function buildPlanJsonOutput(result: AppPlanResult): AppPlanJsonOutput {
  const steps = buildPlanSteps(result);
  const conflicts = collectPlanConflicts(steps);
  const ready =
    conflicts.length === 0 && result.checks.every((c) => c.status !== 'fail');

  return {
    org: result.context.org,
    app: result.context.inputs.app,
    orgPlan: result.context.orgPlan,
    steps,
    checks: result.checks,
    conflicts,
    ready,
  };
}

function formatFileLine(file: PlanStepFile): string {
  switch (file.outcome.kind) {
    case 'create':
      return `    * [create] ${file.path}`;
    case 'merge':
      return `    * [merge] ${file.path}${
        file.outcome.added.length > 0
          ? ` (${file.outcome.added.join(', ')})`
          : ''
      }`;
    case 'noop':
      return `    * [noop] ${file.path}`;
    case 'conflict':
      return `    * [conflict] ${file.path}: ${file.outcome.reason}`;
  }
}

export function formatPlanText(output: AppPlanJsonOutput): string {
  const lines: string[] = [];
  lines.push(
    `App plan: ${output.app} (org: ${output.org}, plan: ${output.orgPlan})`,
  );

  lines.push('');
  lines.push('Steps:');
  for (const step of output.steps) {
    lines.push(`Step ${step.step}${step.parallel ? ' (parallel)' : ''}:`);
    if (step.satisfied) {
      lines.push('  (satisfied immediately — nothing to change)');
    }
    for (const repo of step.repos) {
      if (!repo.hasChanges) {
        lines.push(`  - ${repo.repo} (${repo.baseBranch}): nothing to change`);
      } else {
        lines.push(
          `  - ${repo.repo} (${repo.baseBranch} <- ${repo.headBranch}) — PR: ${repo.prTitle}`,
        );
      }
      for (const file of repo.files) {
        lines.push(formatFileLine(file));
        if (file.notes) {
          for (const note of file.notes) {
            lines.push(`      note: ${note}`);
          }
        }
      }
    }
    if (step.waitFor) {
      lines.push(`  Wait for: ${step.waitFor}`);
    }
  }

  if (output.conflicts.length > 0) {
    lines.push('');
    lines.push(`Conflicts (${output.conflicts.length}):`);
    for (const conflict of output.conflicts) {
      lines.push(`  - ${conflict.repo}:${conflict.path}: ${conflict.reason}`);
    }
  }

  lines.push('');
  lines.push('Checks:');
  const failChecks = output.checks.filter((c) => c.status === 'fail');
  const infoChecks = output.checks.filter((c) => c.status === 'info');
  const passChecks = output.checks.filter((c) => c.status === 'pass');

  for (const check of failChecks) {
    lines.push(`  [fail] ${check.id}: ${check.message}`);
  }
  for (const check of infoChecks) {
    lines.push(`  [info] ${check.id}: ${check.message}`);
  }
  lines.push(`  [pass] ${passChecks.length} passed`);

  const checklistItems: string[] = [];
  for (const check of output.checks) {
    if (check.checklist) {
      checklistItems.push(...check.checklist);
    }
  }
  if (checklistItems.length > 0) {
    lines.push('');
    lines.push('Checklist:');
    for (const item of checklistItems) {
      lines.push(`  - ${item}`);
    }
  }

  lines.push('');
  lines.push(
    output.ready
      ? 'Ready: apply can run.'
      : 'Not ready: resolve failing checks or conflicts before running apply.',
  );

  return lines.join('\n');
}

function assertSafeRelativeSegment(value: string, label: string): void {
  if (isAbsolute(value)) {
    throw new Error(
      `Refusing to write outside --out: ${label} "${value}" is an absolute path.`,
    );
  }
  const segments = value.split(/[/\\]/);
  if (segments.includes('..')) {
    throw new Error(
      `Refusing to write outside --out: ${label} "${value}" contains "..".`,
    );
  }
}

async function assertSafeOutputTarget(
  realRootDir: string,
  segments: string[],
): Promise<void> {
  let current = realRootDir;
  for (let i = 0; i < segments.length; i++) {
    current = resolve(current, segments[i]);
    let st;
    try {
      st = await lstat(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw err;
    }
    if (st.isSymbolicLink()) {
      throw new Error(
        `Refusing to write outside --out: "${current}" is a symlink.`,
      );
    }
    const isLast = i === segments.length - 1;
    if (!isLast && !st.isDirectory()) {
      throw new Error(
        `Refusing to write to --out: "${current}" already exists and is not a directory.`,
      );
    }
    if (isLast && st.isDirectory()) {
      throw new Error(
        `Refusing to write to --out: "${current}" already exists and is a directory.`,
      );
    }
  }
}

export async function writePlanOutputFiles(
  outDir: string,
  steps: PlanStep[],
): Promise<string[]> {
  const rootDir = resolve(outDir);
  let realRootDir: string | undefined;
  const written: string[] = [];

  for (const step of steps) {
    for (const repoEntry of step.repos) {
      const repoName = repoEntry.repo.includes('/')
        ? repoEntry.repo.slice(repoEntry.repo.indexOf('/') + 1)
        : repoEntry.repo;

      for (const file of repoEntry.files) {
        if (
          file.outcome.kind === 'noop' ||
          file.outcome.kind === 'conflict' ||
          file.content === undefined
        ) {
          continue;
        }
        assertSafeRelativeSegment(repoName, 'repo');
        assertSafeRelativeSegment(file.path, 'path');

        const targetPath = resolve(rootDir, repoName, file.path);
        if (!targetPath.startsWith(`${rootDir}${sep}`)) {
          throw new Error(
            `Refusing to write outside --out: resolved path "${targetPath}" escapes "${rootDir}".`,
          );
        }

        if (realRootDir === undefined) {
          try {
            await mkdir(rootDir, { recursive: true });
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
              throw new Error(
                `Refusing to write to --out: "${rootDir}" already exists and is not a directory.`,
              );
            }
            throw err;
          }
          realRootDir = await realpath(rootDir);
        }

        const segments = [
          repoName,
          ...file.path.split(/[/\\]/).filter((s) => s.length > 0),
        ];
        const realTargetPath = resolve(realRootDir, ...segments);
        if (!realTargetPath.startsWith(`${realRootDir}${sep}`)) {
          throw new Error(
            `Refusing to write outside --out: resolved path "${realTargetPath}" escapes "${realRootDir}".`,
          );
        }

        await assertSafeOutputTarget(realRootDir, segments);
        await mkdir(dirname(realTargetPath), { recursive: true });
        await writeFile(realTargetPath, file.content, 'utf8');
        written.push(targetPath);
      }
    }
  }

  return written;
}
