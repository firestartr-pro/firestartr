import { InitializerPatches } from './base';
import { getRepositoryUrl, getDefaultBranch, getPath } from '../config';
import * as path from 'path';

export class BackstageInitializer extends InitializerPatches {
  applicableProviders = ['catalog'];

  static applicableKinds = [
    'ComponentClaim',
    'SystemClaim',
    'DomainClaim',
    'GroupClaim',
    'UserClaim',
    'TFWorkspaceClaim',
    'SecretsClaim',
    'ArgoDeployClaim',
    'OrgWebhookClaim',
  ];

  async __validate() {
    return true;
  }

  async __patches(claim: any, _: any) {
    const claimPath: string | undefined = this.data?.path;
    const repoUrl: string | undefined = getRepositoryUrl();

    let relativePath: string | undefined;
    if (repoUrl && claimPath) {
      const repoRoot = path.dirname(getPath('claims'));
      relativePath = path
        .relative(repoRoot, claimPath)
        .split(path.sep)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    }

    return [
      {
        validate() {
          return true;
        },

        apply(cr: any) {
          cr.metadata.annotations = cr.metadata.annotations ?? {};

          cr.metadata.annotations['backstage.io/kubernetes-id'] = claim.name;

          return cr;
        },

        identify() {
          return 'initializers/BackstageInitializer';
        },

        applicable() {
          return {
            applicableProviders: ['^catalog'],
          };
        },
      },

      {
        validate() {
          return true;
        },

        apply(cr: any) {
          const org = claim.providers?.github?.org;
          const repoName = claim.providers?.github?.name;

          if (!org || !repoName) return cr;

          cr.metadata.annotations = cr.metadata.annotations ?? {};

          if (
            cr.metadata.annotations['github.com/project-slug'] !== undefined
          ) {
            return cr;
          }

          cr.metadata.annotations['github.com/project-slug'] =
            `${org}/${repoName}`;
          return cr;
        },

        identify() {
          return 'initializers/BackstageInitializer';
        },

        applicable() {
          return {
            applicableProviders: ['catalog'],
          };
        },
      },

      {
        validate() {
          return true;
        },

        apply(cr: any) {
          if (!repoUrl || !relativePath) return cr;

          cr.metadata.annotations = cr.metadata.annotations ?? {};

          cr.metadata.annotations['backstage.io/edit-url'] =
            `${repoUrl}/blob/${getDefaultBranch()}/${relativePath}`;
          return cr;
        },

        identify() {
          return 'initializers/BackstageInitializer';
        },

        applicable() {
          return {
            applicableProviders: ['catalog'],
          };
        },
      },
    ];
  }
}
