import common from 'catalog_common';
import * as fs from 'fs';
import { IGithubRepositoryFeatureClaim } from '../claims/github/repositoryFeature';

export async function renderFeature(
  featureName: string,

  featureVersion: string,

  featureOutputObject: any,

  cr: any,

  claimRepoName: string,
): Promise<IGithubRepositoryFeatureClaim> {
  const files: any[] = [];

  for (const fileId in featureOutputObject.files) {
    const fileInfo: any = featureOutputObject.files[fileId];

    const path: string = fileInfo.repoPath;

    const userManaged: boolean = fileInfo.userManaged;

    const contentText: string = fs.readFileSync(fileInfo.localPath, 'utf-8');

    const content: string = Buffer.from(contentText, 'utf8').toString('base64');

    const targetBranch: string = fileInfo.targetBranch;

    files.push({ path, userManaged, content, targetBranch });
  }

  const featName = common.generic.normalizeName(
    `${featureName}-${cr.spec.firestartr.tfStateKey}`,
  );

  const traceability = featureOutputObject.traceability || {};

  return {
    kind: 'GithubRepositoryFeatureClaim',

    version: '1.0.0',

    name: featName,

    feature: {
      name: featureName,

      version: featureVersion,

      ref: traceability.ref,

      repo: traceability.repo,

      sha: traceability.sha,

      tags: traceability.tags,

      url: traceability.url,
    },

    firestartr: { tfStateKey: cr.spec.firestartr.tfStateKey },

    files,

    claimRepoName,

    context: cr.spec.context,

    org: cr.spec.org,

    repositoryTarget: {
      ref: {
        kind: 'FirestartrGithubRepository',

        name: cr.metadata.name,

        needsSecret: true,
      },

      branch: cr.spec.repo.branch,
    },
  };
}
