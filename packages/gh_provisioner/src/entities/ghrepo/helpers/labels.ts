import log from '../../../logger';
import github from 'github';

import { PatchOperations } from '../../base';
import { EntityGHRepo } from '../';

export async function provisionLabels(
  fsGithubRepository: EntityGHRepo,
  repoAlreadyExists: boolean,
): Promise<void> {
  try {
    const cr = fsGithubRepository.cr;
    const labels = cr.spec.repo.labels;

    if (!labels || labels.length === 0) {
      return;
    }

    if (repoAlreadyExists) {
      await importLabelsIfNeeded(fsGithubRepository, labels);
    }

    for (const label of labels) {
      log.debug(
        `[gh-provisioner] ${fsGithubRepository.k8sId} provisioning label ${label.name}`,
      );

      fsGithubRepository.patchData({
        op: PatchOperations.add,
        path: '/config/labels/-',
        value: {
          name: label.name,
          color: label.color,
          description: label.description,
        },
      });
    }
  } catch (err) {
    log.error(
      `[gh-provisioner] ${fsGithubRepository.k8sId} error on provisionLabels: ${err}`,
    );
    throw new Error(`Error on provisionLabels: ${err}`);
  }
}

async function importLabelsIfNeeded(
  fsGithubRepository: EntityGHRepo,
  declaredLabels: { name: string; color: string; description?: string }[],
): Promise<void> {
  const cr = fsGithubRepository.cr;

  try {
    log.info(
      `[gh-provisioner] ${fsGithubRepository.k8sId} checking if labels need to be imported (${declaredLabels.length} declared)`,
    );

    const repoIssuesList = await fsGithubRepository.runWithGithubProvider(
      async () => {
        return await github.repo.getRepoIssuesLabels(cr.spec.org, cr.name);
      },
    );

    for (const label of declaredLabels) {
      const existing = findExistingLabel(label.name, repoIssuesList);
      if (!existing) {
        log.info(
          `[gh-provisioner] ${fsGithubRepository.k8sId} label '${label.name}' not found on GitHub — will be created by TFM`,
        );
        continue;
      }

      log.info(
        `[gh-provisioner] ${fsGithubRepository.k8sId} label '${label.name}' on GitHub: color="${existing.color}" desc="${existing.description}" | CR declares: color="${label.color}" desc="${label.description}"`,
      );

      if (
        existing.color !== label.color ||
        (label.description && existing.description !== label.description)
      ) {
        log.info(
          `[gh-provisioner] ${fsGithubRepository.k8sId} updating pre-existing label '${label.name}' via GitHub API to match CR values`,
        );
        await fsGithubRepository.runWithGithubProvider(async () => {
          await github.repo.updateRepoLabel(
            cr.spec.org,
            cr.name,
            label.name,
            label.color,
            label.description,
          );
        });
      }

      fsGithubRepository.patchImportData({
        op: PatchOperations.add,
        path: '/imports/-',
        value: {
          to: 'github_issue_label.this["' + label.name + '"]',
          id: `${cr.name}:${label.name}`,
        },
      });
    }
  } catch (err) {
    log.error(
      `[gh-provisioner] ${fsGithubRepository.k8sId} error on importLabelsIfNeeded: ${err}`,
    );
    throw new Error(`Error on importLabelsIfNeeded: ${err}`);
  }
}

function findExistingLabel(
  labelName: string,
  repoIssuesList: any,
): any | undefined {
  return repoIssuesList.find((label: any) => label.name === labelName);
}
