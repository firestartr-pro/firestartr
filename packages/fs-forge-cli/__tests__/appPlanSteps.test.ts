import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  appPlanHeadBranch,
  buildPlanSteps,
  writePlanOutputFiles,
  type AppPlanResult,
  type PlanStep,
  type ResolvedPlanContext,
} from '../src/app/plan/index.js';
import type { RenderedFile } from '../src/app/render/index.js';

function makeContext(
  overrides: Partial<ResolvedPlanContext> = {},
): ResolvedPlanContext {
  return {
    org: 'acme',
    claimsRepoName: 'claims',
    inputs: {
      org: 'acme',
      app: 'payments',
      service: { repo: 'payments-api', release_type: 'node' },
      targets: [
        {
          platform: 'eks-main',
          tenant: 'core',
          env: 'dev',
          cluster_url: 'https://eks-main.example.com',
          track: 'snapshots',
        },
      ],
      chart: { name: 'microservice', version: '1.2.3', registry: 'acr-main' },
    },
    orgPlan: 'paid',
    claimsMap: { headers: { sha: 'test' }, claims: {} },
    serviceRepoOwner: 'acme',
    serviceRepoName: 'payments-api',
    defaultBranches: {
      claims: 'main',
      dotFirestartr: 'main',
      stateApp: 'main',
      stateArgocd: 'main',
      service: 'develop',
    },
    serviceClaimPath: 'components/payments-api.yaml',
    serviceClaimContent: '',
    serviceClaimDefaults: { githubOrg: 'acme' },
    featureMajors: {
      build_and_dispatch_docker_images: 7,
      release_please: 2,
      state_repo_apps: 3,
    },
    featureSchemas: {
      build_and_dispatch_docker_images: {},
      release_please: {},
      state_repo_apps: {},
    },
    defaultFilters: { snapshot: 'dev', preReleases: 'pre', releases: 'pro' },
    dotFirestartr: {
      present: true,
      platforms: [],
      registries: [],
      appConfig: { present: false },
      errors: [],
    },
    existingStateAppFiles: {},
    ...overrides,
  };
}

function makePlanResult(files: AppPlanResult['files']): AppPlanResult {
  return {
    context: makeContext(),
    files,
    checks: [],
  };
}

const createFile = (path: string, content = 'k: v\n'): RenderedFile => ({
  path,
  content,
  outcome: { kind: 'create' },
});

const mergeFile = (
  path: string,
  added: string[],
  content = 'k: v\n',
): RenderedFile => ({
  path,
  content,
  outcome: { kind: 'merge', added },
});

const noopFile = (path: string, content = 'k: v\n'): RenderedFile => ({
  path,
  content,
  outcome: { kind: 'noop' },
});

const conflictFile = (path: string, reason: string): RenderedFile => ({
  path,
  outcome: { kind: 'conflict', reason },
});

describe('buildPlanSteps', () => {
  it('builds 3 ordered steps for a new App with deterministic head branch and base branches', () => {
    const steps = buildPlanSteps(
      makePlanResult({
        claims: [
          createFile('components/app-payments.yaml'),
          mergeFile('components/payments-api.yaml', ['release_please']),
        ],
        dotFirestartr: [createFile('apps/payments.yaml')],
        stateApp: [
          createFile('kubernetes/eks-main/core/dev.yaml'),
          createFile('kubernetes/eks-main/core/dev/values.yaml', ''),
        ],
        stateArgocd: [
          createFile('apps/payments/argo-payments.ApplicationSet.yaml'),
          createFile('apps/payments/argo-payments.Project.yaml'),
        ],
        service: [createFile('.github/make_dispatches.yaml')],
      }),
    );

    expect(steps).toHaveLength(3);
    const head = appPlanHeadBranch('payments');
    expect(head).toBe('fs-forge/app-payments');

    // Step 1: claims
    expect(steps[0].step).toBe(1);
    expect(steps[0].parallel).toBe(false);
    expect(steps[0].satisfied).toBe(false);
    expect(steps[0].waitFor).toBe('merged, checks green, provisioned');
    expect(steps[0].repos).toHaveLength(1);
    expect(steps[0].repos[0].repo).toBe('acme/claims');
    expect(steps[0].repos[0].baseBranch).toBe('main');
    expect(steps[0].repos[0].headBranch).toBe(head);
    expect(steps[0].repos[0].prTitle).toBeTruthy();
    expect(steps[0].repos[0].files[0].content).toBe('k: v\n');

    // Step 2: parallel (.firestartr, app-<app>, state-argocd)
    expect(steps[1].step).toBe(2);
    expect(steps[1].parallel).toBe(true);
    expect(steps[1].satisfied).toBe(false);
    expect(steps[1].waitFor).toBe('all three merged');
    expect(steps[1].repos.map((r) => r.repo)).toEqual([
      'acme/.firestartr',
      'acme/app-payments',
      'acme/state-argocd',
    ]);
    for (const repo of steps[1].repos) {
      expect(repo.headBranch).toBe(head);
      expect(repo.hasChanges).toBe(true);
      expect(repo.prTitle).toBeTruthy();
    }

    // Step 3: service repo (uses its own default branch 'develop')
    expect(steps[2].step).toBe(3);
    expect(steps[2].parallel).toBe(false);
    expect(steps[2].satisfied).toBe(false);
    expect(steps[2].waitFor).toBeUndefined();
    expect(steps[2].repos[0].repo).toBe('acme/payments-api');
    expect(steps[2].repos[0].baseBranch).toBe('develop');
    expect(steps[2].repos[0].headBranch).toBe(head);
  });

  it('handles adding a target where .firestartr is noop and other repos change', () => {
    const steps = buildPlanSteps(
      makePlanResult({
        claims: [
          noopFile('components/app-payments.yaml'),
          mergeFile('components/payments-api.yaml', [
            'trigger_filter_by_env_releases',
          ]),
        ],
        dotFirestartr: [noopFile('apps/payments.yaml')],
        stateApp: [createFile('kubernetes/eks-main/core/pro.yaml')],
        stateArgocd: [
          mergeFile('apps/payments/argo-payments.ApplicationSet.yaml', [
            'eks-main',
          ]),
          mergeFile('apps/payments/argo-payments.Project.yaml', [
            'core-payments-pro',
          ]),
        ],
        service: [mergeFile('.github/make_dispatches.yaml', ['pro'])],
      }),
    );

    // Step 1 has 1 noop + 1 merge -> PR needed, noop file omits content
    expect(steps[0].satisfied).toBe(false);
    expect(steps[0].repos[0].hasChanges).toBe(true);
    expect(steps[0].repos[0].files[0].content).toBeUndefined();
    expect(steps[0].repos[0].files[1].content).toBe('k: v\n');

    // Step 2: .firestartr has no PR, others do
    expect(steps[1].satisfied).toBe(false);
    expect(steps[1].repos[0].hasChanges).toBe(false);
    expect(steps[1].repos[0].prTitle).toBeUndefined();
    expect(steps[1].repos[0].summary).toBe('nothing to change');
    expect(steps[1].repos[1].hasChanges).toBe(true);
    expect(steps[1].repos[2].hasChanges).toBe(true);
  });

  it('marks all steps satisfied immediately on a full rerun with no PRs', () => {
    const steps = buildPlanSteps(
      makePlanResult({
        claims: [
          noopFile('components/app-payments.yaml'),
          noopFile('components/payments-api.yaml'),
        ],
        dotFirestartr: [noopFile('apps/payments.yaml')],
        stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
        stateArgocd: [
          noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
          noopFile('apps/payments/argo-payments.Project.yaml'),
        ],
        service: [noopFile('.github/make_dispatches.yaml')],
      }),
    );

    for (const step of steps) {
      expect(step.satisfied).toBe(true);
      expect(step.waitFor).toBeUndefined();
      for (const repo of step.repos) {
        expect(repo.hasChanges).toBe(false);
        expect(repo.prTitle).toBeUndefined();
        expect(repo.summary).toBe('nothing to change');
        for (const file of repo.files) {
          expect(file.content).toBeUndefined();
        }
      }
    }
  });

  it('keeps step 2 unsatisfied when only one of the three repos changed', () => {
    const steps = buildPlanSteps(
      makePlanResult({
        claims: [noopFile('components/app-payments.yaml')],
        dotFirestartr: [noopFile('apps/payments.yaml')],
        stateApp: [createFile('kubernetes/eks-main/core/qa.yaml')],
        stateArgocd: [
          noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
        ],
        service: [noopFile('.github/make_dispatches.yaml')],
      }),
    );

    expect(steps[0].satisfied).toBe(true);
    expect(steps[1].satisfied).toBe(false);
    expect(steps[1].waitFor).toBe('all three merged');
    expect(steps[1].repos[0].hasChanges).toBe(false);
    expect(steps[1].repos[1].hasChanges).toBe(true);
    expect(steps[1].repos[2].hasChanges).toBe(false);
    expect(steps[2].satisfied).toBe(true);
  });
});

describe('writePlanOutputFiles', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'fs-forge-out-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes only non-noop, non-conflict files to <dir>/<repo>/<path>', async () => {
    const steps = buildPlanSteps(
      makePlanResult({
        claims: [
          createFile('components/app-payments.yaml', 'claim-content\n'),
          noopFile('components/payments-api.yaml', 'noop-content\n'),
        ],
        dotFirestartr: [conflictFile('apps/payments.yaml', 'legacy repo')],
        stateApp: [],
        stateArgocd: [],
        service: [
          mergeFile('.github/make_dispatches.yaml', ['dev'], 'dispatches\n'),
        ],
      }),
    );

    const written = await writePlanOutputFiles(outDir, steps);
    expect(written).toEqual([
      join(outDir, 'claims', 'components/app-payments.yaml'),
      join(outDir, 'payments-api', '.github/make_dispatches.yaml'),
    ]);

    const content1 = await readFile(written[0], 'utf8');
    expect(content1).toBe('claim-content\n');
    const content2 = await readFile(written[1], 'utf8');
    expect(content2).toBe('dispatches\n');
  });

  it('rejects ".." traversal paths', async () => {
    const steps: PlanStep[] = [
      {
        step: 1,
        parallel: false,
        satisfied: false,
        repos: [
          {
            repo: 'acme/claims',
            baseBranch: 'main',
            headBranch: 'fs-forge/app-payments',
            hasChanges: true,
            summary: 'pr',
            files: [
              {
                path: '../../outside.yaml',
                outcome: { kind: 'create' },
                content: 'bad',
              },
            ],
          },
        ],
      },
    ];

    await expect(writePlanOutputFiles(outDir, steps)).rejects.toThrow(
      /Refusing to write outside --out/,
    );
  });

  it('rejects absolute paths', async () => {
    const steps: PlanStep[] = [
      {
        step: 1,
        parallel: false,
        satisfied: false,
        repos: [
          {
            repo: 'acme/claims',
            baseBranch: 'main',
            headBranch: 'fs-forge/app-payments',
            hasChanges: true,
            summary: 'pr',
            files: [
              {
                path: '/etc/passwd',
                outcome: { kind: 'create' },
                content: 'bad',
              },
            ],
          },
        ],
      },
    ];

    await expect(writePlanOutputFiles(outDir, steps)).rejects.toThrow(
      /Refusing to write outside --out/,
    );
  });
});
