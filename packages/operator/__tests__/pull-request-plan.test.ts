jest.mock('github', () => ({
  __esModule: true,
  default: {
    pulls: {
      getPrFiles: jest.fn(),
      getPrBaseSHA: jest.fn(),
    },
    repo: {
      getContent: jest.fn(),
    },
  },
}));

jest.mock('catalog_common', () => ({
  __esModule: true,
  default: {
    io: {
      fromYaml: jest.fn((content: string) => JSON.parse(content)),
    },
  },
}));

jest.mock('../src/resolver', () => ({
  __esModule: true,
  resolve: jest.fn(async () => ({ dep: true })),
}));

jest.mock('../src/ctl', () => ({
  __esModule: true,
  addPlanStatusCheck: jest.fn(async () => undefined),
  getItemByItemPath: jest.fn(),
  getSecret: jest.fn(),
}));

jest.mock('terraform_provisioner', () => ({
  __esModule: true,
  runTerraformProvisioner: jest.fn(async (_ctx, command: string) => {
    return `${command} output`;
  }),
}));

jest.mock('../src/tfworkspaces/process-operation', () => ({
  __esModule: true,
  buildProvisionerContext: jest.fn(() => ({ context: true })),
}));

jest.mock('../src/user-feedback-ops/user-feedback-ops', () => ({
  __esModule: true,
  publishPlan: jest.fn(async () => undefined),
}));

jest.mock('../src/utils', () => ({
  __esModule: true,
  extractErrorDetails: jest.fn((error: any) => ({
    output: error?.message || String(error),
  })),
}));

jest.mock('gh_provisioner', () => ({
  __esModule: true,
  default: {
    runGhProvisioner: jest.fn(async (_data, opts) => {
      return opts.planDestroy ? 'plan-destroy output' : 'plan output';
    }),
  },
}));

import github from 'github';
import { runTerraformProvisioner } from 'terraform_provisioner';
import ghProvisioner from 'gh_provisioner';
import { resolve } from '../src/resolver';
import { addPlanStatusCheck, getItemByItemPath } from '../src/ctl';
import { publishPlan } from '../src/user-feedback-ops/user-feedback-ops';
import { pullRequestPlan } from '../src/pull-request-plan';

describe('pullRequestPlan', () => {
  const githubMock = github as any;

  const opts = {
    prNumber: 42,
    repo: 'state-github',
    owner: 'prefapp',
    namespace: 'default',
    ref: 'feature-branch',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    githubMock.pulls.getPrBaseSHA.mockResolvedValue('base-sha');
    (resolve as jest.Mock).mockImplementation(async () => ({ dep: true }));
  });

  it('keeps planning modified Terraform workspaces with terraform_provisioner', async () => {
    const cr = resource('FirestartrTerraformWorkspace', 'workspace-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'workspace.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(addPlanStatusCheck).toHaveBeenNthCalledWith(
      1,
      'prefapp/state-github#42',
      'Plan in progress...',
    );
    expect(github.repo.getContent).toHaveBeenCalledWith(
      'workspace.yaml',
      'state-github',
      'prefapp',
      'feature-branch',
    );
    expect(runTerraformProvisioner).toHaveBeenCalledWith(
      { context: true },
      'plan',
      undefined,
    );
    expect(publishPlan).toHaveBeenCalledWith(
      cr,
      'plan output',
      42,
      'state-github',
      'prefapp',
      true,
      'plan',
      'workspace.yaml',
    );
  });

  it('plans deleted Terraform workspaces as destroy plans', async () => {
    const cr = resource('FirestartrTerraformWorkspace', 'workspace-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'workspace.yaml', status: 'removed' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(github.repo.getContent).toHaveBeenCalledWith(
      'workspace.yaml',
      'state-github',
      'prefapp',
      'base-sha',
    );
    expect(runTerraformProvisioner).toHaveBeenCalledWith(
      { context: true },
      'plan-destroy',
      undefined,
    );
  });

  it('plans modified GitHub resources with gh_provisioner', async () => {
    const cr = resource('FirestartrGithubGroup', 'group-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'group.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: cr,
        deps: { dep: true },
      },
      { plan: true },
    );
    expect(publishPlan).toHaveBeenCalledWith(
      cr,
      'plan output',
      42,
      'state-github',
      'prefapp',
      true,
      'plan',
      'group.yaml',
    );
  });

  it('plans GitHub organization settings with gh_provisioner', async () => {
    const cr = resource(
      'FirestartrGithubOrganizationSettings',
      'org-settings',
    );

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'org-settings.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: cr,
        deps: { dep: true },
      },
      { plan: true },
    );
    expect(publishPlan).toHaveBeenCalledWith(
      cr,
      'plan output',
      42,
      'state-github',
      'prefapp',
      true,
      'plan',
      'org-settings.yaml',
    );
  });

  it('plans deleted GitHub resources as destroy plans', async () => {
    const cr = resource('FirestartrGithubGroup', 'group-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'group.yaml', status: 'removed' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: cr,
        deps: { dep: true },
      },
      { planDestroy: true },
    );
  });

  it('reuses the PR base SHA for multiple deleted files', async () => {
    const group = resource('FirestartrGithubGroup', 'group-a');
    const repo = resource('FirestartrGithubRepository', 'repo-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'group.yaml', status: 'removed' },
        { filename: 'repo.yaml', status: 'removed' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'group.yaml') return JSON.stringify(group);
      return JSON.stringify(repo);
    });

    await pullRequestPlan(opts);

    expect(githubMock.pulls.getPrBaseSHA).toHaveBeenCalledTimes(1);
    expect(github.repo.getContent).toHaveBeenCalledWith(
      'group.yaml',
      'state-github',
      'prefapp',
      'base-sha',
    );
    expect(github.repo.getContent).toHaveBeenCalledWith(
      'repo.yaml',
      'state-github',
      'prefapp',
      'base-sha',
    );
  });

  it('plans multiple supported resources and skips unsupported files', async () => {
    const tfCr = resource('FirestartrTerraformWorkspace', 'workspace-a');
    const ghCr = resource('FirestartrGithubGroup', 'group-a');
    const unsupported = resource('ConfigMap', 'config-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'workspace.yaml', status: 'modified' },
        { filename: 'group.yaml', status: 'modified' },
        { filename: 'config.yaml', status: 'modified' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'workspace.yaml') return JSON.stringify(tfCr);
      if (filename === 'group.yaml') return JSON.stringify(ghCr);
      return JSON.stringify(unsupported);
    });

    await pullRequestPlan(opts);

    expect(runTerraformProvisioner).toHaveBeenCalledTimes(1);
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledTimes(1);
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Skipped files: 1'),
      'completed',
      false,
    );
  });

  it('continues planning remaining resources after one resource fails', async () => {
    const tfCr = resource('FirestartrTerraformWorkspace', 'workspace-a');
    const ghCr = resource('FirestartrGithubGroup', 'group-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'workspace.yaml', status: 'modified' },
        { filename: 'group.yaml', status: 'modified' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'workspace.yaml') return JSON.stringify(tfCr);
      return JSON.stringify(ghCr);
    });
    (runTerraformProvisioner as jest.Mock).mockRejectedValueOnce(
      new Error('terraform failed'),
    );

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledTimes(1);
    expect(publishPlan).toHaveBeenCalledWith(
      tfCr,
      'terraform failed',
      42,
      'state-github',
      'prefapp',
      false,
      'plan',
      'workspace.yaml',
    );
    expect(publishPlan).toHaveBeenCalledWith(
      ghCr,
      'plan output',
      42,
      'state-github',
      'prefapp',
      true,
      'plan',
      'group.yaml',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Failed resources: 1'),
      'completed',
      true,
    );
  });

  it('keeps aggregate check failure details concise', async () => {
    const tfCr = resource('FirestartrTerraformWorkspace', 'workspace-a');
    const longFailure = `terraform failed\n${'details '.repeat(100)}`;

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'workspace.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(tfCr));
    (runTerraformProvisioner as jest.Mock).mockRejectedValueOnce(
      new Error(longFailure),
    );

    await pullRequestPlan(opts);

    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('terraform failed'),
      'completed',
      true,
    );
    expect(addPlanStatusCheck).not.toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('details details'),
      'completed',
      true,
    );
    expect(publishPlan).toHaveBeenCalledWith(
      tfCr,
      longFailure,
      42,
      'state-github',
      'prefapp',
      false,
      'plan',
      'workspace.yaml',
    );
  });

  it('skips non-YAML files before parsing content', async () => {
    const ghCr = resource('FirestartrGithubGroup', 'group-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'README.md', status: 'modified' },
        { filename: 'group.yaml', status: 'modified' },
      ],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(ghCr));

    await pullRequestPlan(opts);

    expect(github.repo.getContent).toHaveBeenCalledTimes(1);
    expect(github.repo.getContent).toHaveBeenCalledWith(
      'group.yaml',
      'state-github',
      'prefapp',
      'feature-branch',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Skipped files: 1'),
      'completed',
      false,
    );
  });

  it('keeps aggregate check counts at the end when many files are summarized', async () => {
    const cr = resource('FirestartrGithubGroup', 'group-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'group.yaml', status: 'modified' },
        ...Array.from({ length: 25 }, (_value, index) => ({
          filename: `docs/file-${index}.md`,
          status: 'modified',
        })),
      ],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    const addPlanStatusCheckMock = addPlanStatusCheck as jest.Mock;
    const [, summary] = addPlanStatusCheckMock.mock.calls[addPlanStatusCheckMock.mock.calls.length - 1];

    expect(summary).toContain('omitted detail lines: 6');
    expect(summary).toMatch(
      /Plan completed\nPlanned resources: 1\nFailed resources: 0\nSkipped files: 25$/,
    );
  });

  it('plans renamed files from the PR ref', async () => {
    const cr = resource('FirestartrGithubGroup', 'group-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'group.yaml', status: 'renamed' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(github.repo.getContent).toHaveBeenCalledWith(
      'group.yaml',
      'state-github',
      'prefapp',
      'feature-branch',
    );
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: cr,
        deps: { dep: true },
      },
      { plan: true },
    );
  });

  it('plans copied and changed YAML files from the PR ref', async () => {
    const copiedCr = resource('FirestartrGithubGroup', 'group-a');
    const changedCr = resource('FirestartrGithubMembership', 'member-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'group.yaml', status: 'copied' },
        { filename: 'member.yaml', status: 'changed' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'group.yaml') return JSON.stringify(copiedCr);

      return JSON.stringify(changedCr);
    });

    await pullRequestPlan(opts);

    expect(github.repo.getContent).toHaveBeenCalledWith(
      'group.yaml',
      'state-github',
      'prefapp',
      'feature-branch',
    );
    expect(github.repo.getContent).toHaveBeenCalledWith(
      'member.yaml',
      'state-github',
      'prefapp',
      'feature-branch',
    );
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledTimes(2);
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: copiedCr,
        deps: { dep: true },
      },
      { plan: true },
    );
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: changedCr,
        deps: { dep: true },
      },
      { plan: true },
    );
  });

  it('skips unchanged and unrecognized file statuses before fetching content', async () => {
    const cr = resource('FirestartrGithubGroup', 'group-a');

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'unchanged.yaml', status: 'unchanged' },
        { filename: 'unknown.yaml', status: 'unknown' },
        { filename: 'group.yaml', status: 'modified' },
      ],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(github.repo.getContent).toHaveBeenCalledTimes(1);
    expect(github.repo.getContent).toHaveBeenCalledWith(
      'group.yaml',
      'state-github',
      'prefapp',
      'feature-branch',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Skipped files: 2'),
      'completed',
      false,
    );
  });

  it('resolves GitHub resource refs from the same PR before Kubernetes', async () => {
    const repo = resource('FirestartrGithubRepository', 'repo-a');
    const feature: any = resource(
      'FirestartrGithubRepositoryFeature',
      'feature-a',
    );
    feature.spec.repositoryTarget = {
      ref: {
        kind: 'FirestartrGithubRepository',
        name: 'repo-a',
        needsSecret: false,
      },
    };

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'repo.yaml', status: 'modified' },
        { filename: 'feature.yaml', status: 'modified' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'repo.yaml') return JSON.stringify(repo);
      return JSON.stringify(feature);
    });
    (resolve as jest.Mock).mockImplementation(async (cr, getItem) => {
      if (cr.kind === 'FirestartrGithubRepositoryFeature') {
        return {
          repo: await getItem('default/githubrepositories/repo-a'),
        };
      }

      return {};
    });

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: feature,
        deps: { repo },
      },
      { plan: true },
    );
    expect(
      (getItemByItemPath as jest.Mock).mock.calls.map(([path]) => path),
    ).not.toContain('default/githubrepositories/repo-a');
  });

  it('skips repository dependents when the target repository is added in the same PR', async () => {
    const repo = resource('FirestartrGithubRepository', 'repo-a');
    const feature: any = resource(
      'FirestartrGithubRepositoryFeature',
      'feature-a',
    );
    const secrets: any = resource(
      'FirestartrGithubRepositorySecretsSection',
      'repo-a',
    );

    feature.spec.repositoryTarget = {
      ref: {
        kind: 'FirestartrGithubRepository',
        name: 'repo-a',
        needsSecret: false,
      },
    };
    secrets.spec.repositoryTarget = feature.spec.repositoryTarget;

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'repo.yaml', status: 'added' },
        { filename: 'feature.yaml', status: 'added' },
        { filename: 'secrets.yaml', status: 'added' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'repo.yaml') return JSON.stringify(repo);
      if (filename === 'feature.yaml') return JSON.stringify(feature);
      if (filename === 'secrets.yaml') return JSON.stringify(secrets);

      throw Object.assign(new Error('Not Found'), { status: 404 });
    });

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledTimes(1);
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: repo,
        deps: { dep: true },
      },
      { plan: true },
    );
    expect(publishPlan).toHaveBeenCalledWith(
      feature,
      expect.stringContaining('targets FirestartrGithubRepository/repo-a'),
      42,
      'state-github',
      'prefapp',
      true,
      'plan-skipped',
      'feature.yaml',
    );
    expect(publishPlan).toHaveBeenCalledWith(
      secrets,
      expect.stringContaining('targets FirestartrGithubRepository/repo-a'),
      42,
      'state-github',
      'prefapp',
      true,
      'plan-skipped',
      'secrets.yaml',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Failed resources: 0'),
      'completed',
      false,
    );

    const baseLookupCalls = githubMock.repo.getContent.mock.calls.filter(
      (call: any[]) => call[0] === 'FirestartrGithubRepository.repo-a.yaml',
    );

    expect(baseLookupCalls).toHaveLength(1);
  });

  it('resolves deleted feature refs to deleted GitHub resources from the base state', async () => {
    const repo = resource('FirestartrGithubRepository', 'repo-a');
    const feature: any = resource(
      'FirestartrGithubRepositoryFeature',
      'feature-a',
    );

    feature.spec.repositoryTarget = {
      ref: {
        kind: 'FirestartrGithubRepository',
        name: 'repo-a',
        needsSecret: false,
      },
    };

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'repo.yaml', status: 'removed' },
        { filename: 'feature.yaml', status: 'removed' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'repo.yaml') return JSON.stringify(repo);
      if (filename === 'feature.yaml') return JSON.stringify(feature);
      if (filename === 'FirestartrGithubRepository.repo-a.yaml') {
        return JSON.stringify(repo);
      }

      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    (resolve as jest.Mock).mockImplementation(async (cr, getItem) => {
      if (cr.kind === 'FirestartrGithubRepositoryFeature') {
        const repository = await getItem('default/githubrepositories/repo-a');

        if (!repository) {
          throw new Error(
            'FirestartrGithubRepository-repo-a could not be resolved',
          );
        }

        return { repo: repository };
      }

      return { dep: true };
    });

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: feature,
        deps: { repo },
      },
      { planDestroy: true },
    );
    expect(github.repo.getContent).toHaveBeenCalledWith(
      'FirestartrGithubRepository.repo-a.yaml',
      'state-github',
      'prefapp',
      'base-sha',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Failed resources: 0'),
      'completed',
      false,
    );
  });

  it('resolves deleted secrets section refs to deleted GitHub resources from the base state', async () => {
    const repo = resource('FirestartrGithubRepository', 'repo-a');
    const secrets: any = resource(
      'FirestartrGithubRepositorySecretsSection',
      'repo-a',
    );

    secrets.spec.repositoryTarget = {
      ref: {
        kind: 'FirestartrGithubRepository',
        name: 'repo-a',
        needsSecret: false,
      },
    };

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'repo.yaml', status: 'removed' },
        { filename: 'secrets.yaml', status: 'removed' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'repo.yaml') return JSON.stringify(repo);
      if (filename === 'secrets.yaml') return JSON.stringify(secrets);
      if (filename === 'FirestartrGithubRepository.repo-a.yaml') {
        return JSON.stringify(repo);
      }

      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    (resolve as jest.Mock).mockImplementation(async (cr, getItem) => {
      if (cr.kind === 'FirestartrGithubRepositorySecretsSection') {
        const repository = await getItem('default/githubrepositories/repo-a');

        if (!repository) {
          throw new Error(
            'FirestartrGithubRepository-repo-a could not be resolved',
          );
        }

        return { repo: repository };
      }

      return { dep: true };
    });

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: secrets,
        deps: { repo },
      },
      { planDestroy: true },
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Failed resources: 0'),
      'completed',
      false,
    );
  });

  it('fails deleted resources when deleted GitHub resource refs are missing from the base state', async () => {
    const repo = resource('FirestartrGithubRepository', 'repo-a');
    const feature: any = resource(
      'FirestartrGithubRepositoryFeature',
      'feature-a',
    );

    feature.spec.repositoryTarget = {
      ref: {
        kind: 'FirestartrGithubRepository',
        name: 'repo-a',
        needsSecret: false,
      },
    };

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'repo.yaml', status: 'removed' },
        { filename: 'feature.yaml', status: 'removed' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'repo.yaml') return JSON.stringify(repo);
      if (filename === 'feature.yaml') return JSON.stringify(feature);

      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    (resolve as jest.Mock).mockImplementation(async (cr, getItem) => {
      if (cr.kind === 'FirestartrGithubRepositoryFeature') {
        const repository = await getItem('default/githubrepositories/repo-a');

        if (!repository) {
          throw new Error(
            'FirestartrGithubRepository-repo-a could not be resolved',
          );
        }

        return { repo: repository };
      }

      return { dep: true };
    });

    await pullRequestPlan(opts);

    expect(publishPlan).toHaveBeenCalledWith(
      feature,
      'FirestartrGithubRepository-repo-a could not be resolved',
      42,
      'state-github',
      'prefapp',
      false,
      'plan-destroy',
      'feature.yaml',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Failed resources: 1'),
      'completed',
      true,
    );
  });

  it('fails resources that reference GitHub resources deleted in the same PR', async () => {
    const repo = resource('FirestartrGithubRepository', 'repo-a');
    const feature: any = resource(
      'FirestartrGithubRepositoryFeature',
      'feature-a',
    );

    feature.spec.repositoryTarget = {
      ref: {
        kind: 'FirestartrGithubRepository',
        name: 'repo-a',
        needsSecret: false,
      },
    };

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [
        { filename: 'repo.yaml', status: 'removed' },
        { filename: 'feature.yaml', status: 'modified' },
      ],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'repo.yaml') return JSON.stringify(repo);
      if (filename === 'feature.yaml') return JSON.stringify(feature);
      if (filename === 'FirestartrGithubRepository.repo-a.yaml') {
        return JSON.stringify(repo);
      }

      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    (resolve as jest.Mock).mockImplementation(async (cr, getItem) => {
      if (cr.kind === 'FirestartrGithubRepositoryFeature') {
        const repository = await getItem('default/githubrepositories/repo-a');

        if (!repository) {
          throw new Error(
            'FirestartrGithubRepository-repo-a could not be resolved',
          );
        }

        return { repo: repository };
      }

      return { dep: true };
    });

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledTimes(1);
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: repo,
        deps: { dep: true },
      },
      { planDestroy: true },
    );
    expect(publishPlan).toHaveBeenCalledWith(
      feature,
      'FirestartrGithubRepository-repo-a could not be resolved',
      42,
      'state-github',
      'prefapp',
      false,
      'plan',
      'feature.yaml',
    );
    expect(
      (getItemByItemPath as jest.Mock).mock.calls.map(([path]) => path),
    ).not.toContain('default/githubrepositories/repo-a');
    expect(github.repo.getContent).not.toHaveBeenCalledWith(
      'FirestartrGithubRepository.repo-a.yaml',
      'state-github',
      'prefapp',
      'base-sha',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Failed resources: 1'),
      'completed',
      true,
    );
  });

  it('resolves existing GitHub resource refs from the base state files before Kubernetes', async () => {
    const group: any = resource('FirestartrGithubGroup', 'group-a');
    const member = resource('FirestartrGithubMembership', 'member-a');

    group.spec.members = [
      {
        ref: {
          kind: 'FirestartrGithubMembership',
          name: 'member-a',
          needsSecret: false,
        },
      },
    ];

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'group.yaml', status: 'added' }],
    });
    githubMock.repo.getContent.mockImplementation(async (filename: string) => {
      if (filename === 'group.yaml') return JSON.stringify(group);
      if (filename === 'FirestartrGithubMembership.member-a.yaml') {
        return JSON.stringify(member);
      }

      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    (resolve as jest.Mock).mockImplementation(async (_cr, getItem) => ({
      member: await getItem('default/githubmemberships/member-a'),
    }));

    await pullRequestPlan(opts);

    expect(github.repo.getContent).toHaveBeenCalledWith(
      'FirestartrGithubMembership.member-a.yaml',
      'state-github',
      'prefapp',
      'base-sha',
    );
    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: group,
        deps: { member },
      },
      { plan: true },
    );
    expect(
      (getItemByItemPath as jest.Mock).mock.calls.map(([path]) => path),
    ).not.toContain('default/githubmemberships/member-a');
  });

  it('fails the aggregate check when no supported resources are found', async () => {
    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'config.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(
      JSON.stringify(resource('ConfigMap', 'config-a')),
    );

    await pullRequestPlan(opts);

    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      'No supported Firestartr resources found in PR 42 in state-github',
      'completed',
      true,
    );
  });

  it('plans supported resources with metadata.generateName before planning', async () => {
    const cr = resource('FirestartrGithubGroup', 'group-a');
    delete cr.metadata.name;
    (cr.metadata as any).generateName = 'generated-group-';

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'group.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).toHaveBeenCalledWith(
      {
        mainCr: cr,
        deps: { dep: true },
      },
      { plan: true },
    );
    expect(publishPlan).toHaveBeenCalledWith(
      cr,
      'plan output',
      42,
      'state-github',
      'prefapp',
      true,
      'plan',
      'group.yaml',
    );
  });

  it('publishes failed feedback for supported resources without an identifier', async () => {
    const cr = resource('FirestartrGithubGroup', 'group-a');
    delete cr.metadata.name;

    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'group.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify(cr));

    await pullRequestPlan(opts);

    expect(ghProvisioner.runGhProvisioner).not.toHaveBeenCalled();
    expect(publishPlan).toHaveBeenCalledWith(
      {
        ...cr,
        metadata: {
          ...cr.metadata,
          generateName: 'group.yaml',
        },
      },
      'Missing metadata.name or metadata.generateName in group.yaml',
      42,
      'state-github',
      'prefapp',
      false,
      'plan',
      'group.yaml',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining(
        'Missing metadata.name or metadata.generateName in group.yaml',
      ),
      'completed',
      true,
    );
  });

  it('publishes failed feedback for malformed YAML files', async () => {
    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'broken.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue('{');

    await pullRequestPlan(opts);

    expect(publishPlan).toHaveBeenCalledWith(
      {
        kind: 'UnknownKind',
        metadata: {
          name: 'broken.yaml',
        },
      },
      expect.any(String),
      42,
      'state-github',
      'prefapp',
      false,
      'plan',
      'broken.yaml',
    );
  });

  it('publishes failed feedback for YAML files without a kind', async () => {
    githubMock.pulls.getPrFiles.mockResolvedValue({
      data: [{ filename: 'missing-kind.yaml', status: 'modified' }],
    });
    githubMock.repo.getContent.mockResolvedValue(JSON.stringify({ spec: {} }));

    await pullRequestPlan(opts);

    expect(publishPlan).toHaveBeenCalledWith(
      {
        kind: 'UnknownKind',
        metadata: {
          name: 'missing-kind.yaml',
        },
      },
      'Missing Kubernetes kind in missing-kind.yaml',
      42,
      'state-github',
      'prefapp',
      false,
      'plan',
      'missing-kind.yaml',
    );
    expect(addPlanStatusCheck).toHaveBeenLastCalledWith(
      'prefapp/state-github#42',
      expect.stringContaining('Failed resources: 1'),
      'completed',
      true,
    );
  });
});

function resource(kind: string, name: string) {
  return {
    apiVersion: 'firestartr.dev/v1',
    kind,
    metadata: {
      annotations: {},
      name,
    },
    spec: {},
  };
}
