import log from './logger';

const MODULES = {
  FirestartrGithubGroup: {
    module: 'git::https://github.com/prefapp/tfm.git//modules/github-team',
    // github-team-v0.2.0
    ref: '6f1e31d8573bc614f22a9ac75e622ed970d3725b',
  },
  FirestartrGithubRepositorySecretsSection: {
    module:
      'git::https://github.com/prefapp/tfm.git//modules/github-repo-secrets-section',
    // github-repo-secrets-section-v0.1.2
    ref: 'c2e983dc57d8f879fd8ec4df048fbb604e4f04b2',
  },
  FirestartrGithubRepository: {
    module: 'git::https://github.com/prefapp/tfm.git//modules/github-repo',
    // github-repo feat/1385: add public and https_enforced to pages
    ref: '441b93d8a0d78f6088db096a852305f63a227eaa',
  },
  FirestartrGithubRepositoryFeature: {
    module: 'git::https://github.com/prefapp/tfm.git//modules/github-files-set',
    // github-files-set-v0.1.2
    ref: 'c6522aeeaeb807b6142c83f850ba4af4de7fe50f',
  },
  FirestartrGithubMembership: {
    module:
      'git::https://github.com/prefapp/tfm.git//modules/github-membership',
    // github-membership-v0.2.0
    ref: '2f58407e00ecde5e242a90c82214535907c9a49b',
  },
  FirestartrGithubOrgWebhook: {
    module:
      'git::https://github.com/prefapp/tfm.git//modules/github-org-webhook',
    // github-org-webhook-v0.2.0
    ref: '12d72ba15780647b2f9c2905938913344bfeaa4d',
  },
  FirestartrGithubOrganizationSettings: {
    module:
      'git::https://github.com/prefapp/tfm.git//modules/github-org-settings',
    // github-org-settings-v0.1.0
    ref: 'c30c5dfdaddf2bca9e966a726d45970c98576e9e',
  },
  FirestartrGithubOrganizationVariableSection: {
    module:
      'git::https://github.com/prefapp/tfm.git//modules/github-org-variables-section',
    // github-org-variables-section-v0.1.0
    ref: 'fb9c01d0a1e03e5134479da13d0faf55891dfedf',
  },
};

export function getFirestartrDefaultTFM(kind: string) {
  if (kind in MODULES) {
    return MODULES[kind];
  } else {
    log.error(`No default terraform module for kind ${kind}`);

    throw new Error(`No default terraform module for kind ${kind}`);
  }
}
