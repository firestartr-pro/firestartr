import { applyApp } from '../src/app/apply/index.js';
import type {
  AppPlanResult,
  PlanCheck,
  ResolvedPlanContext,
} from '../src/app/plan/index.js';
import type { RenderedFile } from '../src/app/render/index.js';
import type { RepoRef } from '../src/github/api.js';

import { MemoryGitHubApi } from './fixtures/memoryGitHubApi.js';

class ApplyTestGitHubApi extends MemoryGitHubApi {
  readonly prStates = new Map<string, { state: string; merged: boolean }>();
  readonly staleBranches = new Set<string>();
  onGetPullRequest?: (ref: RepoRef, pr: number) => void;

  setPrState(
    ref: RepoRef,
    pr: number,
    state: 'open' | 'closed',
    merged: boolean,
  ): void {
    this.prStates.set(`${this.key(ref)}#${pr}`, { state, merged });
  }

  addStaleBranch(ref: RepoRef, branch: string): void {
    this.staleBranches.add(`${this.key(ref)}@${branch}`);
  }

  override async createBranch(
    ref: RepoRef,
    branch: string,
    sha: string,
  ): Promise<void> {
    if (this.staleBranches.has(`${this.key(ref)}@${branch}`)) {
      throw Object.assign(new Error('Reference already exists'), {
        status: 422,
      });
    }
    return super.createBranch(ref, branch, sha);
  }

  override async getPullRequest(
    ref: RepoRef,
    pr: number,
  ): Promise<{
    number: number;
    htmlUrl: string;
    state: string;
    merged: boolean;
  }> {
    this.onGetPullRequest?.(ref, pr);
    const base = await super.getPullRequest(ref, pr);
    const override = this.prStates.get(`${this.key(ref)}#${pr}`);
    if (override) {
      return { ...base, ...override };
    }
    return base;
  }
}

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
    repoState: {
      dotFirestartr: { exists: true, archived: false },
      stateArgocd: { exists: true, archived: false },
      service: { exists: true, archived: false },
    },
    defaultBranches: {
      claims: 'main',
      dotFirestartr: 'main',
      stateApp: 'main',
      stateArgocd: 'main',
      service: 'main',
    },
    serviceClaimPath: 'claims/components/payments-api.yaml',
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

function makeFullPlan(
  overrides: Partial<AppPlanResult['files']> = {},
  checks: PlanCheck[] = [],
): AppPlanResult {
  return {
    context: makeContext(),
    files: {
      claims: [
        createFile('claims/components/app-payments.yaml', 'app-claim\n'),
        mergeFile(
          'claims/components/payments-api.yaml',
          ['release_please'],
          'service-claim\n',
        ),
      ],
      dotFirestartr: [createFile('apps/payments.yaml', 'dot-app\n')],
      stateApp: [
        createFile('kubernetes/eks-main/core/dev.yaml', 'env-yaml\n'),
        createFile('kubernetes/eks-main/core/dev/values.yaml', ''),
      ],
      stateArgocd: [
        createFile('apps/payments/argo-payments.ApplicationSet.yaml', 'appset\n'),
        createFile('apps/payments/argo-payments.Project.yaml', 'proj\n'),
      ],
      service: [
        mergeFile('.github/make_dispatches.yaml', ['dev'], 'dispatches\n'),
      ],
      ...overrides,
    },
    checks,
  };
}

function makeFakeClock() {
  let current = 1_000_000;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function makeApi(): ApplyTestGitHubApi {
  const api = new ApplyTestGitHubApi();
  api.autoCompleteDispatches = true;
  api.setFile(
    { owner: 'acme', repo: 'claims' },
    'claims/components/payments-api.yaml',
    'old-service-claim\n',
    'svc-claim-sha',
  );
  api.setFile(
    { owner: 'acme', repo: 'payments-api' },
    '.github/make_dispatches.yaml',
    'deployments: []\n',
    'dispatches-sha',
  );
  return api;
}

describe('applyApp', () => {
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enforces step order: step 1 claims sequentially, then all step 2 PRs before waiting, then step 3 after step 2 merges', async () => {
    const api = makeApi();
    const clock = makeFakeClock();

    // Auto-merge any PR when polled
    api.onGetPullRequest = (ref, pr) => {
      api.setPrState(ref, pr, 'closed', true);
    };

    const result = await applyApp(api, makeFullPlan(), {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].repos.map((r) => r.state)).toEqual([
      'provisioned',
      'provisioned',
    ]);
    expect(result.steps[1].repos.map((r) => r.state)).toEqual([
      'merged',
      'merged',
      'merged',
    ]);
    expect(result.steps[2].repos.map((r) => r.state)).toEqual(['merged']);

    // Verify exact ordering in api.calls:
    // 1. app-payments claim dispatched before payments-api claim created
    const appClaimDispatchIdx = api.calls.findIndex((c) =>
      c.startsWith('dispatchWorkflow acme/claims:provision-claim.yaml'),
    );
    const svcClaimBranchIdx = api.calls.findIndex((c) =>
      c.startsWith(
        'createBranch acme/claims@fs-forge/ComponentClaim-payments-api',
      ),
    );
    expect(appClaimDispatchIdx).toBeGreaterThan(-1);
    expect(svcClaimBranchIdx).toBeGreaterThan(appClaimDispatchIdx);

    // 2. Step 2 PRs are all opened before any getPullRequest for step 2
    const dotPrIdx = api.calls.findIndex((c) =>
      c.startsWith('createPullRequest acme/.firestartr@fs-forge/app-payments'),
    );
    const stateAppPrIdx = api.calls.findIndex((c) =>
      c.startsWith('createPullRequest acme/app-payments@fs-forge/app-payments'),
    );
    const argoPrIdx = api.calls.findIndex((c) =>
      c.startsWith('createPullRequest acme/state-argocd@fs-forge/app-payments'),
    );
    const firstGetPrIdx = api.calls.findIndex((c) =>
      c.startsWith('getPullRequest '),
    );
    expect(dotPrIdx).toBeGreaterThan(svcClaimBranchIdx);
    expect(stateAppPrIdx).toBeGreaterThan(dotPrIdx);
    expect(argoPrIdx).toBeGreaterThan(stateAppPrIdx);
    expect(firstGetPrIdx).toBeGreaterThan(argoPrIdx);

    // 3. Step 3 PR is opened only after all step 2 PRs have been polled/merged
    const lastStep2PollIdx = Math.max(
      api.calls.findIndex((c) => c.startsWith('getPullRequest acme/.firestartr')),
      api.calls.findIndex((c) => c.startsWith('getPullRequest acme/app-payments')),
      api.calls.findIndex((c) => c.startsWith('getPullRequest acme/state-argocd')),
    );
    const step3PrIdx = api.calls.findIndex((c) =>
      c.startsWith('createPullRequest acme/payments-api@fs-forge/app-payments'),
    );
    expect(step3PrIdx).toBeGreaterThan(lastStep2PollIdx);

    // Verify merge sha was passed for existing files
    const svcClaimCommit = api.committed.find(
      (c) => c.path === 'claims/components/payments-api.yaml',
    );
    expect(svcClaimCommit?.sha).toBe('svc-claim-sha');
    const dispatchesCommit = api.committed.find(
      (c) => c.path === '.github/make_dispatches.yaml',
    );
    expect(dispatchesCommit?.sha).toBe('dispatches-sha');
  });

  it('names the state-repo PR and the failing checks when a step 1 claim fails its wet PR checks', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const state = { owner: 'acme', repo: 'state-github' };
    api.setPullRequests(state, [
      {
        number: 7,
        htmlUrl: 'https://github.com/acme/state-github/pull/7',
        state: 'open',
        headRef: 'automated-component-app-payments',
        baseSha: 'base-sha',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    api.setCheckRuns(state, 7, [
      {
        name: 'FirestartrGithubRepository - apply',
        conclusion: 'failure',
        status: 'completed',
        output: {
          title: null,
          summary: 'ComponentClaim/app-payments: failure',
          text: null,
        },
        htmlUrl: 'https://github.com/acme/state-github/runs/1',
      },
    ]);

    const result = await applyApp(api, makeFullPlan(), {
      now: clock.now,
      sleep: clock.sleep,
    });

    const expected =
      'Wet PR checks failed: failure (acme/state-github#7 https://github.com/acme/state-github/pull/7, FirestartrGithubRepository - apply https://github.com/acme/state-github/runs/1)';
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe(expected);
    expect(result.steps[0].repos[0]).toEqual({
      repo: 'acme/claims',
      branch: 'fs-forge/ComponentClaim-app-payments',
      state: 'failed',
      reason: `ComponentClaim/app-payments: ${expected}`,
    });
  });

  it('writes nothing when the plan is not ready (failing check or conflict)', async () => {
    const api1 = makeApi();
    const res1 = await applyApp(
      api1,
      makeFullPlan({}, [{ id: 'vars', status: 'fail', message: 'missing var' }]),
    );
    expect(res1.outcome).toBe('not_ready');
    expect(api1.committed).toHaveLength(0);
    expect(api1.createdPulls).toHaveLength(0);
    expect(api1.dispatched).toHaveLength(0);
    expect(api1.issues).toHaveLength(0);
    expect(
      api1.calls.filter((c) => c.startsWith('createBranch ')),
    ).toHaveLength(0);

    const api2 = makeApi();
    const res2 = await applyApp(
      api2,
      makeFullPlan({
        dotFirestartr: [conflictFile('apps/payments.yaml', 'legacy repo')],
      }),
    );
    expect(res2.outcome).toBe('not_ready');
    expect(api2.committed).toHaveLength(0);
    expect(api2.createdPulls).toHaveLength(0);
    expect(api2.dispatched).toHaveLength(0);
    expect(api2.issues).toHaveLength(0);
    expect(
      api2.calls.filter((c) => c.startsWith('createBranch ')),
    ).toHaveLength(0);
  });

  it('with noWait lands only the first unsatisfied step and stops with pending', async () => {
    // Case A: step 1 is unsatisfied
    const api1 = makeApi();
    const res1 = await applyApp(api1, makeFullPlan(), { noWait: true });
    expect(res1.outcome).toBe('pending');
    expect(res1.steps).toHaveLength(1);
    expect(res1.steps[0].step).toBe(1);
    expect(res1.steps[0].repos.map((r) => r.state)).toEqual(['open', 'open']);
    expect(api1.createdPulls).toHaveLength(0);

    // Case B: step 1 is satisfied, step 2 is first unsatisfied
    const api2 = makeApi();
    const planStep2 = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
    });
    const res2 = await applyApp(api2, planStep2, { noWait: true });
    expect(res2.outcome).toBe('pending');
    expect(res2.steps).toHaveLength(2);
    expect(res2.steps[0].repos.every((r) => r.state === 'skipped')).toBe(true);
    expect(res2.steps[1].repos.map((r) => r.state)).toEqual([
      'open',
      'open',
      'open',
    ]);
    // Step 3 was not opened
    expect(api2.createdPulls.map((p) => p.ref.repo)).toEqual([
      '.firestartr',
      'app-payments',
      'state-argocd',
    ]);
  });

  it('returns pending with pending PRs listed on timeout without real time', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
    });

    // PRs stay open forever; timeout after 10s with 5s poll interval
    const result = await applyApp(api, plan, {
      timeoutMs: 10_000,
      pollIntervalMs: 5_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('pending');
    expect(result.reason).toContain('Timed out');
    expect(result.reason).toContain('acme/.firestartr#1');
    expect(result.steps[1].repos.every((r) => r.state === 'open')).toBe(true);
    expect(result.steps[1].repos[0].reason).toBe('timed out waiting for merge');
  });

  it('fails and names the PR when a PR is closed without merging', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
    });

    api.onGetPullRequest = (ref, pr) => {
      if (ref.repo === 'app-payments') {
        api.setPrState(ref, pr, 'closed', false);
      } else {
        api.setPrState(ref, pr, 'closed', true);
      }
    };

    const result = await applyApp(api, plan, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('acme/app-payments#2');
    expect(result.reason).toContain('closed without merging');
    expect(result.steps[1].repos[1].state).toBe('failed');
  });

  it('reuses an existing open PR on resume without recreating branch or PR', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const dotRef = { owner: 'acme', repo: '.firestartr' };
    api.setPullRequests(dotRef, [
      {
        number: 42,
        htmlUrl: 'https://github.com/acme/.firestartr/pull/42',
        state: 'open',
        headRef: 'fs-forge/app-payments',
        baseRef: 'main',
        baseSha: 'base-sha',
        updatedAt: '',
      },
    ]);
    api.setFile(dotRef, 'apps/payments.yaml', 'dot-app\n');

    api.onGetPullRequest = (ref, pr) => {
      api.setPrState(ref, pr, 'closed', true);
    };

    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
      stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
      stateArgocd: [
        noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
      ],
      service: [noopFile('.github/make_dispatches.yaml')],
    });

    const result = await applyApp(api, plan, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(result.steps[1].repos[0]).toEqual({
      repo: 'acme/.firestartr',
      branch: 'fs-forge/app-payments',
      pr: {
        number: 42,
        url: 'https://github.com/acme/.firestartr/pull/42',
      },
      state: 'merged',
    });
    expect(api.createdPulls).toHaveLength(0);
    expect(
      api.calls.filter((c) => c.startsWith('createBranch acme/.firestartr')),
    ).toHaveLength(0);
  });

  it('fails with a delete-branch message when head branch exists with no open PR', async () => {
    // Step 2 stale branch
    const api = makeApi();
    api.addStaleBranch(
      { owner: 'acme', repo: '.firestartr' },
      'fs-forge/app-payments',
    );
    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
    });

    const result = await applyApp(api, plan);
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('Branch already exists');
    expect(result.reason).toContain('Delete it');
    expect(result.steps[1].repos[0].state).toBe('failed');

    // Step 1 stale claim branch
    const api2 = makeApi();
    api2.addStaleBranch(
      { owner: 'acme', repo: 'claims' },
      'fs-forge/ComponentClaim-app-payments',
    );
    const result2 = await applyApp(api2, makeFullPlan());
    expect(result2.outcome).toBe('failed');
    expect(result2.reason).toContain('Branch already exists');
    expect(result2.reason).toContain('Delete it');
    expect(result2.steps[0].repos[0].state).toBe('failed');
  });

  it('publishes only the changed claim when only one of the two claims has changes', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        mergeFile(
          'claims/components/payments-api.yaml',
          ['release_please'],
          'service-claim\n',
        ),
      ],
      dotFirestartr: [noopFile('apps/payments.yaml')],
      stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
      stateArgocd: [
        noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
      ],
      service: [noopFile('.github/make_dispatches.yaml')],
    });

    const result = await applyApp(api, plan, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(result.steps[0].repos[0].state).toBe('skipped');
    expect(result.steps[0].repos[1].state).toBe('provisioned');
    expect(api.dispatched).toHaveLength(1);
    expect(api.dispatched[0].inputs.claimName).toBe('payments-api');
  });

  it('opens ONE audit issue for step 1 and links it to both claim PRs with distinct titles', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const plan = makeFullPlan({
      dotFirestartr: [noopFile('apps/payments.yaml')],
      stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
      stateArgocd: [
        noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
      ],
      service: [noopFile('.github/make_dispatches.yaml')],
    });

    const result = await applyApp(api, plan, {
      audit: { createIssue: true },
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(result.auditIssue).toEqual({
      number: 1,
      url: 'https://github.com/acme/claims/issues/1',
    });
    expect(api.issues).toHaveLength(1);
    expect(api.createdPulls).toHaveLength(2);
    expect(api.createdPulls[0]).toMatchObject({
      head: 'fs-forge/ComponentClaim-app-payments',
      title: 'ci: provision claim ComponentClaim/app-payments',
      body: 'Closes #1',
    });
    expect(api.createdPulls[1]).toMatchObject({
      head: 'fs-forge/ComponentClaim-payments-api',
      title: 'ci: provision claim ComponentClaim/payments-api',
      body: 'Closes #1',
    });
    // Both workflow runs commented on the single issue
    expect(api.issueComments.filter((c) => c.issue === 1)).toHaveLength(2);
  });

  it('enforces per-step timeoutMs in step 1 and returns pending with the in-progress claim open', async () => {
    const api = makeApi();
    api.autoCompleteDispatches = false;
    const clock = makeFakeClock();

    // Workflow run stays in_progress forever so dispatch polling hits timeoutMs
    api.setWorkflowRuns(
      { owner: 'acme', repo: 'claims' },
      'provision-claim.yaml',
      'fs-forge/ComponentClaim-app-payments',
      [],
    );
    const origListRuns = api.listWorkflowRuns.bind(api);
    api.listWorkflowRuns = async (ref, input) => {
      const dispatch = api.dispatched.find(
        (d) => d.gitRef === input.branch && d.workflowId === input.workflowId,
      );
      if (dispatch) {
        return [
          {
            id: 99,
            htmlUrl: 'https://github.com/acme/claims/actions/runs/99',
            status: 'in_progress',
            conclusion: null,
            displayTitle: String(dispatch.inputs.correlationId),
          },
        ];
      }
      return origListRuns(ref, input);
    };

    const result = await applyApp(api, makeFullPlan(), {
      timeoutMs: 10_000,
      pollIntervalMs: 5_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('pending');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].repos[0].state).toBe('open');
    expect(result.steps[0].repos[0].reason).toContain(
      'https://github.com/acme/claims/actions/runs/99',
    );
  });

  it('returns failed (without throwing) when createPullRequest or commitFile throws mid-step in step 2', async () => {
    // Case A: createPullRequest throws on 3rd repo
    const api1 = makeApi();
    const clock1 = makeFakeClock();
    const origCreatePr = api1.createPullRequest.bind(api1);
    api1.createPullRequest = async (ref, input) => {
      if (ref.repo === 'state-argocd') {
        throw new Error('boom: createPullRequest 500');
      }
      return origCreatePr(ref, input);
    };

    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
    });

    const res1 = await applyApp(api1, plan, {
      now: clock1.now,
      sleep: clock1.sleep,
    });

    expect(res1.outcome).toBe('failed');
    expect(res1.reason).toContain('boom: createPullRequest 500');
    expect(res1.steps[1].repos).toHaveLength(3);
    expect(res1.steps[1].repos[0]).toMatchObject({
      repo: 'acme/.firestartr',
      state: 'open',
      pr: { number: 1 },
    });
    expect(res1.steps[1].repos[1]).toMatchObject({
      repo: 'acme/app-payments',
      state: 'open',
      pr: { number: 2 },
    });
    expect(res1.steps[1].repos[2]).toMatchObject({
      repo: 'acme/state-argocd',
      state: 'failed',
      reason: 'boom: createPullRequest 500',
    });

    // Case B: commitFile throws on 2nd repo
    const api2 = makeApi();
    const clock2 = makeFakeClock();
    const origCommit = api2.commitFile.bind(api2);
    api2.commitFile = async (ref, input) => {
      if (ref.repo === 'app-payments') {
        throw new Error('boom: commitFile 500');
      }
      return origCommit(ref, input);
    };

    const res2 = await applyApp(api2, plan, {
      now: clock2.now,
      sleep: clock2.sleep,
    });

    expect(res2.outcome).toBe('failed');
    expect(res2.reason).toContain('boom: commitFile 500');
    expect(res2.steps[1].repos[0]).toMatchObject({
      repo: 'acme/.firestartr',
      state: 'open',
      pr: { number: 1 },
    });
    expect(res2.steps[1].repos[1]).toMatchObject({
      repo: 'acme/app-payments',
      state: 'failed',
      reason: 'boom: commitFile 500',
    });
  });

  it('fails without overwriting when a reused open PR does not match the current plan', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const dotRef = { owner: 'acme', repo: '.firestartr' };
    api.setPullRequests(dotRef, [
      {
        number: 42,
        htmlUrl: 'https://github.com/acme/.firestartr/pull/42',
        state: 'open',
        headRef: 'fs-forge/app-payments',
        baseRef: 'main',
        baseSha: 'base-sha',
        updatedAt: '',
      },
    ]);
    api.setFile(dotRef, 'apps/payments.yaml', 'stale-content\n');

    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
      stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
      stateArgocd: [
        noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
      ],
      service: [noopFile('.github/make_dispatches.yaml')],
    });

    const result = await applyApp(api, plan, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.steps[1].repos[0].state).toBe('failed');
    expect(result.steps[1].repos[0].reason).toContain('acme/.firestartr#42');
    expect(result.steps[1].repos[0].reason).toContain('apps/payments.yaml');
    expect(api.committed).toHaveLength(0);
    expect(api.createdPulls).toHaveLength(0);
  });

  it('fails naming both PRs when two open PRs exist on the same head branch', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const dotRef = { owner: 'acme', repo: '.firestartr' };
    api.setPullRequests(dotRef, [
      {
        number: 7,
        htmlUrl: 'https://github.com/acme/.firestartr/pull/7',
        state: 'open',
        headRef: 'fs-forge/app-payments',
        baseRef: 'main',
        baseSha: 'base-sha',
        updatedAt: '',
      },
      {
        number: 8,
        htmlUrl: 'https://github.com/acme/.firestartr/pull/8',
        state: 'open',
        headRef: 'fs-forge/app-payments',
        baseRef: 'main',
        baseSha: 'base-sha',
        updatedAt: '',
      },
    ]);

    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
      stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
      stateArgocd: [
        noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
      ],
      service: [noopFile('.github/make_dispatches.yaml')],
    });

    const result = await applyApp(api, plan, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.steps[1].repos[0].state).toBe('failed');
    expect(result.steps[1].repos[0].reason).toContain('acme/.firestartr#7');
    expect(result.steps[1].repos[0].reason).toContain('acme/.firestartr#8');
    expect(api.createdPulls).toHaveLength(0);
  });

  it('fails without overwriting when a reused open PR touches files outside the plan changes', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const dotRef = { owner: 'acme', repo: '.firestartr' };
    api.setPullRequests(dotRef, [
      {
        number: 42,
        htmlUrl: 'https://github.com/acme/.firestartr/pull/42',
        state: 'open',
        headRef: 'fs-forge/app-payments',
        baseRef: 'main',
        baseSha: 'base-sha',
        updatedAt: '',
      },
    ]);
    api.setFile(dotRef, 'apps/payments.yaml', 'dot-app\n');
    api.setPullRequestFiles(dotRef, 42, [
      { filename: 'apps/payments.yaml', status: 'added' },
      { filename: 'apps/other.yaml', status: 'modified' },
    ]);

    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
      stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
      stateArgocd: [
        noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
      ],
      service: [noopFile('.github/make_dispatches.yaml')],
    });

    const result = await applyApp(api, plan, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.steps[1].repos[0].state).toBe('failed');
    expect(result.steps[1].repos[0].reason).toContain('acme/.firestartr#42');
    expect(result.steps[1].repos[0].reason).toContain('apps/other.yaml');
    expect(api.committed).toHaveLength(0);
    expect(api.createdPulls).toHaveLength(0);
  });

  it('reuses an existing open PR when content differs only in CRLF vs LF line endings', async () => {
    const api = makeApi();
    const clock = makeFakeClock();
    const dotRef = { owner: 'acme', repo: '.firestartr' };
    api.setPullRequests(dotRef, [
      {
        number: 42,
        htmlUrl: 'https://github.com/acme/.firestartr/pull/42',
        state: 'open',
        headRef: 'fs-forge/app-payments',
        baseRef: 'main',
        baseSha: 'base-sha',
        updatedAt: '',
      },
    ]);
    api.setFile(dotRef, 'apps/payments.yaml', 'dot-app\r\n');
    api.setPullRequestFiles(dotRef, 42, [
      { filename: 'apps/payments.yaml', status: 'added' },
    ]);

    api.onGetPullRequest = (ref, pr) => {
      api.setPrState(ref, pr, 'closed', true);
    };

    const plan = makeFullPlan({
      claims: [
        noopFile('claims/components/app-payments.yaml'),
        noopFile('claims/components/payments-api.yaml'),
      ],
      stateApp: [noopFile('kubernetes/eks-main/core/dev.yaml')],
      stateArgocd: [
        noopFile('apps/payments/argo-payments.ApplicationSet.yaml'),
      ],
      service: [noopFile('.github/make_dispatches.yaml')],
    });

    const result = await applyApp(api, plan, {
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(result.steps[1].repos[0].state).toBe('merged');
    expect(api.committed).toHaveLength(0);
    expect(api.createdPulls).toHaveLength(0);
  });
});
