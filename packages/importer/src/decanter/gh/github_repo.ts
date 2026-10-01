import {
  BranchStrategiesInitializer,
  GithubRepositoryOverrider,
  InitializerDefault,
} from 'cdk8s_renderer';

import github from 'github';
import { getDefaultOwnerHandles } from '../config';
import { GithubDecanter } from './base';
import log from '../../logger';
import { extractFromCodeOwners } from '../../utils/codeowner';

import { transformRepoName } from '../../utils/nomicon';

const TYPE_MAP: any = {
  User: 'user',
  Team: 'group',
  Organization: 'org',
};

const DEFAULT_LABELS = [
  'bug',
  'documentation',
  'duplicate',
  'enhancement',
  'good first issue',
  'help wanted',
  'invalid',
  'question',
  'wontfix',
];

export default class RepoGithubDecanter extends GithubDecanter {
  // GATHER: Check if the repo is empty
  async __gatherIsEmpty() {
    this.data['isEmpty'] = await github.repo.isEmptyRepo(
      this.org,
      this.data.repoDetails.name,
    );
  }

  // DECANT: Block import if repo is empty
  __decantValidateNotEmpty() {
    if (this.data.isEmpty) {
      const repoFullName = `${this.org}/${this.data.repoDetails.name}`;
      throw new Error(
        `The repo ${repoFullName} is empty - no commits, therefore CAN NOT be imported. ` +
          'Create it with Firestartr or fill it with some README.md or another initial file or code',
      );
    }
  }

  githubTeams: any;

  constructor(data: any, org: string, githubTeams: any = {}) {
    super(data, org);
    this.githubTeams = githubTeams;
  }

  claimKind = 'ComponentClaim';

  __decantStart() {
    this.claim = {
      kind: this.claimKind,

      version: this.VERSION(),

      type: 'service',

      lifecycle: 'production',

      name: transformRepoName(this.data.repoDetails.name),
    };
  }

  __decantProviders() {
    this.__patchClaim({
      op: 'add',
      value: {
        github: {
          description: this.data.repoDetails.description || '',

          name: this.data.repoDetails.name,

          org: this.org,

          visibility: this.data.repoDetails.visibility,

          branchStrategy: {
            name: this.data.branchStrategy.kind,

            defaultBranch: this.data.repoDetails.default_branch,
          },
          topics: this.data.repoDetails.topics,
          hasWiki: this.data.repoDetails.has_wiki,
          ...(this.data.repoDetails.has_discussions === true && {
            hasDiscussions: true,
          }),
        },
      },
      path: '/providers',
    });
  }

  __decantPages() {
    if (this.data.pages) {
      const pagesData = this.data.pages;

      const supportedBuildTypes = ['workflow', 'legacy'];

      if (!supportedBuildTypes.includes(pagesData.build_type)) {
        return;
      }

      const pagesConfig: any = {
        buildType: pagesData.build_type,

        ...(typeof pagesData.cname === 'string' && pagesData.cname.length > 0
          ? { cname: pagesData.cname }
          : {}),

        ...(typeof pagesData.public === 'boolean'
          ? { public: pagesData.public }
          : {}),

        ...(typeof pagesData.https_enforced === 'boolean'
          ? { https_enforced: pagesData.https_enforced }
          : {}),
      };

      if (pagesData.build_type === 'legacy') {
        pagesConfig.source = pagesData.source;
      }

      this.__patchClaim({
        op: 'add',

        path: '/providers/github/pages',

        value: pagesConfig,
      });
    }
  }

  __decantOIDC() {
    if (this.data.oidc) {
      this.__patchClaim({
        op: 'add',

        value: {},

        path: '/providers/github/actions',
      });

      this.__patchClaim({
        op: 'add',

        path: '/providers/github/actions',

        value: {
          oidc: {
            useDefault: this.data.oidc.use_default,

            includeClaimKeys: this.data.oidc.include_claim_keys,
          },
        },
      });
    }
  }

  // only for validation
  __decantValidateCodeowners() {
    if (this.data.codeowners) {
      const owners = extractFromCodeOwners(this.data.codeowners);

      const normalizeTeamIdentifier = (value: string) => {
        const normalizedValue = (
          value.startsWith('@') ? value.slice(1) : value
        ).toLowerCase();

        if (!normalizedValue.includes('/')) {
          return normalizedValue;
        }

        const [org, slug, ...rest] = normalizedValue.split('/');
        if (!org || !slug || rest.length > 0) {
          return null;
        }

        return org === this.org.toLowerCase() ? slug : null;
      };

      const isInTeams = (teamSlugInCodeowners: string) => {
        const normalizedTeamSlug =
          normalizeTeamIdentifier(teamSlugInCodeowners);
        if (!normalizedTeamSlug) {
          return false;
        }

        return this.data.teamsAndMembers.teams.some((team: any) => {
          return team.slug?.toLowerCase() === normalizedTeamSlug;
        });
      };

      const isInUsers = (userName: string) => {
        // strip the leading '@' for users (CODEOWNERS format: @username)
        // and normalize to lowercase for case-insensitive comparison
        const normalizedUserName = (
          userName.startsWith('@') ? userName.slice(1) : userName
        ).toLowerCase();
        return (
          this.data.teamsAndMembers.directMembers.some(
            (member: any) => member.name?.toLowerCase() === normalizedUserName,
          ) ||
          this.data.teamsAndMembers.outsideMembers.some(
            (member: any) => member.name?.toLowerCase() === normalizedUserName,
          )
        );
      };

      // The default owner is resolved once in the importer/configuration layer
      // from claims_defaults.yaml, through the same claim-to-external-name
      // mapping used by CODEOWNERS generation. ComponentClaim.owner is a claim
      // reference (e.g. "group:group_a" or "user:user_a"), not a GitHub handle,
      // so we must compare against the resolved external name.
      let defaultOwnerTeamHandle: string | null = null;
      let defaultOwnerUserHandle: string | null = null;
      const defaultOwnerHandles = getDefaultOwnerHandles();
      if (defaultOwnerHandles.team) {
        defaultOwnerTeamHandle = defaultOwnerHandles.team;
      }
      if (defaultOwnerHandles.user) {
        defaultOwnerUserHandle = defaultOwnerHandles.user;
      }

      const isDefaultOwner = (owner: { isTeam: boolean; name: string }) => {
        const normalized = owner.name.toLowerCase();
        if (owner.isTeam) return normalized === defaultOwnerTeamHandle;
        return normalized === defaultOwnerUserHandle;
      };

      // let's validate that every element in the
      // CODEOWNERS file is either a team or a user in the repository,
      // otherwise we will have dangling references in the claim which will cause issues down the line
      for (const owner of owners) {
        if (owner.isTeam && !isInTeams(owner.name)) {
          if (isDefaultOwner(owner)) {
            log.warn(
              `[${this.org}/${this.data.repoDetails.name}] CODEOWNERS file references default owner team ${owner.name} which is not yet in the repository's teams — will be granted on provisioning; continuing.`,
            );
            continue;
          }
          log.error(
            `[${this.org}/${this.data.repoDetails.name}] CODEOWNERS file references team ${owner.name} which is not present in the repository's teams.`,
          );
          throw new Error(
            `[${this.org}/${this.data.repoDetails.name}] CODEOWNERS file references team ${owner.name} which is not present in the repository's teams.`,
          );
        } else if (!owner.isTeam && !isInUsers(owner.name)) {
          if (isDefaultOwner(owner)) {
            log.warn(
              `[${this.org}/${this.data.repoDetails.name}] CODEOWNERS file references default owner user ${owner.name} not yet collaborator — will be granted on provisioning; continuing.`,
            );
            continue;
          }
          log.error(
            `[${this.org}/${this.data.repoDetails.name}] CODEOWNERS file references user ${owner.name} which is not present in the repository's collaborators.`,
          );
          throw new Error(
            `[${this.org}/${this.data.repoDetails.name}] CODEOWNERS file references user ${owner.name} which is not present in the repository's collaborators.`,
          );
        }
      }
    }
  }

  __decantRelations() {
    const directMaintainers: any = this.data.teamsAndMembers.directMembers
      .filter((member: any) => member.role === 'maintain')
      .map((member: any) => {
        return `user-imported-ref:${member.name}`;
      });

    const outsideMaintainers: any = this.data.teamsAndMembers.outsideMembers
      .filter((member: any) => member.role === 'maintain')
      .map((member: any) => {
        return `collaborator:${member.name.toLowerCase()}`;
      });

    const teamMaintainers: any = this.data.teamsAndMembers.teams
      .filter((team: any) => team.role === 'maintain')
      .map((team: any) => {
        return `group-imported-ref:${team.name}`;
      });

    const maintainers = directMaintainers
      .concat(outsideMaintainers)
      .concat(teamMaintainers);

    if (maintainers && maintainers.length > 0) {
      this.__patchClaim({
        op: 'add',

        value: maintainers,

        path: '/maintainedBy',
      });
    }

    const directAdmins: any = this.data.teamsAndMembers.directMembers
      .filter((member: any) => member.role === 'admin')
      .map((member: any) => {
        return `user-imported-ref:${member.name}`;
      });

    const outsideAdmins: any = this.data.teamsAndMembers.outsideMembers
      .filter((member: any) => member.role === 'admin')
      .map((member: any) => {
        return `collaborator:${member.name.toLowerCase()}`;
      });

    const teamAdmins: any = this.data.teamsAndMembers.teams
      .filter((team: any) => team.role === 'admin')
      .map((team: any) => {
        return `group-imported-ref:${team.name}`;
      });

    const admins = directAdmins.concat(outsideAdmins).concat(teamAdmins);

    const overrides: any = {};

    if (admins && admins.length > 1) {
      overrides['additionalAdmins'] = [];

      for (let i = 1; i < admins.length; i++) {
        overrides.additionalAdmins.push(admins[i]);
      }

      this.__patchClaim({
        op: 'add',

        value: { ...overrides },

        path: '/providers/github/overrides',
      });
    }

    const directWriters: any = this.data.teamsAndMembers.directMembers
      .filter((member: any) => member.role === 'write')
      .map((member: any) => {
        return `user-imported-ref:${member.name}`;
      });

    const outsideWriters: any = this.data.teamsAndMembers.outsideMembers
      .filter((member: any) => member.role === 'write')
      .map((member: any) => {
        return `collaborator:${member.name.toLowerCase()}`;
      });

    const teamWriters: any = this.data.teamsAndMembers.teams
      .filter((team: any) => ['push', 'write'].includes(team.role))
      .map((team: any) => {
        return `group-imported-ref:${team.name}`;
      });

    const writers = directWriters.concat(outsideWriters).concat(teamWriters);

    if (writers && writers.length > 0) {
      overrides['additionalWriters'] = writers;

      this.__patchClaim({
        op: 'add',

        value: { ...overrides },

        path: '/providers/github/overrides',
      });
    }

    const directReaders: any = this.data.teamsAndMembers.directMembers
      .filter((member: any) => member.role === 'read')
      .map((member: any) => {
        return `user-imported-ref:${member.name}`;
      });

    const outsideReaders: any = this.data.teamsAndMembers.outsideMembers
      .filter((member: any) => member.role === 'read')
      .map((member: any) => {
        return `collaborator:${member.name.toLowerCase()}`;
      });

    const teamReaders: any = this.data.teamsAndMembers.teams
      .filter((team: any) => ['pull', 'read'].includes(team.role))
      .map((team: any) => {
        return `group-imported-ref:${team.name}`;
      });

    const readers = directReaders.concat(outsideReaders).concat(teamReaders);

    if (readers && readers.length > 0) {
      ((overrides['additionalReaders'] = readers),
        this.__patchClaim({
          op: 'add',

          value: { ...overrides },

          path: '/providers/github/overrides',
        }));
    }
  }

  async __decantRepoLabels() {
    let labels = this.data.labels || [];

    labels = labels.filter((label: any) => {
      return !DEFAULT_LABELS.includes(label.name);
    });

    if (labels && labels.length > 0) {
      this.__patchClaim({
        op: 'add',

        value: labels,

        path: '/providers/github/labels',
      });
    }
  }

  async __gatherRepoTeamsAndMembers() {
    this.data['teamsAndMembers'] = {};

    const directMembers = (
      await github.repo.getCollaborators(
        this.data.repoDetails.owner.login,

        this.data.repoDetails.name,

        'direct',
      )
    ).map((member: any) => {
      return { name: member.login, role: member.role_name };
    });

    const outsideMembers = (
      await github.repo.getCollaborators(
        this.data.repoDetails.owner.login,

        this.data.repoDetails.name,

        'outside',
      )
    ).map((member: any) => {
      return { name: member.login, role: member.role_name };
    });

    const teams = Object.keys(this.githubTeams).map((teamName: string) => {
      return {
        name: teamName,
        role: this.githubTeams[teamName].permission.toLowerCase(),
        slug: this.githubTeams[teamName].slug,
      };
    });

    this.data['teamsAndMembers']['teams'] = teams;

    // GitHub's `affiliation=direct` includes outside collaborators, so we must
    // exclude them from directMembers to avoid tagging them as user-imported-ref.
    const outsideMemberNames = new Set(
      outsideMembers.map((m: any) => m.name.toLowerCase()),
    );
    const filteredDirectMembers = directMembers.filter(
      (m: any) => !outsideMemberNames.has(m.name.toLowerCase()),
    );

    this.data['teamsAndMembers']['directMembers'] = filteredDirectMembers;

    this.data['teamsAndMembers']['outsideMembers'] = outsideMembers;
  }

  async __gatherPages() {
    if (this.data.repoDetails.has_pages) {
      const pages = await github.repo.getPages(
        this.org,
        this.data.repoDetails.name,
      );

      this.data['pages'] = pages;
    }
  }

  async __gatherOIDCSubjectClaim() {
    const oidc = await github.repo.getOIDCRepo(
      this.org,
      this.data.repoDetails.name,
    );

    this.data['oidc'] = oidc.data;
  }

  async __gatherBranchStrategy() {
    let value = 'custom';

    let bpInfo: any | undefined;

    try {
      bpInfo = await github.repo.getBranchProtection(
        this.org,

        this.data.repoDetails.name,

        this.data.repoDetails.default_branch,
      );
    } catch (e: any) {
      value = 'none';
    }

    this.data['branchStrategy'] = { kind: value, data: bpInfo };
  }

  async __gatherCodeowners() {
    const codeownersPaths = [
      '.github/CODEOWNERS',
      'CODEOWNERS',
      'docs/CODEOWNERS',
    ];

    for (const codeownersPath of codeownersPaths) {
      try {
        const codeowners = await github.repo.getContent(
          codeownersPath,
          this.data.repoDetails.name,
          this.org,
        );

        this.data['codeowners'] = codeowners;
        return;
      } catch (e: any) {
        const status = e?.status ?? e?.response?.status;

        if (status === 404) {
          continue;
        }

        throw e;
      }
    }

    log.info(
      `No CODEOWNERS file found for ${this.data.repoDetails.name}, skipping.`,
    );
  }

  async __gatherRepoLabels() {
    try {
      const labels = await github.repo.getRepoIssuesLabels(
        this.org,

        this.data.repoDetails.name,
      );

      this.data['labels'] = labels;
    } catch (e: any) {
      log.error(
        `Error fetching labels for ${this.data.repoDetails.name}: ${e.message}`,
      );
      throw new Error(
        `Error fetching labels for ${this.data.repoDetails.name}: ${e.message}`,
      );
    }
  }

  async __adaptInitializerBranchStrategies(_claim: any) {
    const bpData = this.data.branchStrategy.data;

    if (this.data.branchStrategy.kind === 'custom') {
      const branchStrategiesDefault: any = {
        name: 'branchStrategies',

        apiVersion: 'firestartr.dev/v1',

        kind: 'FirestartrGithubRepository',

        virtual: true,

        defaultValues: {
          strategies: [
            {
              name: 'custom',

              values: {
                defaultBranch: this.data.repoDetails.default_branch,

                branchProtections: [
                  {
                    branch: this.data.repoDetails.default_branch,
                    statusChecks: bpData?.required_status_checks?.contexts
                      ? bpData?.required_status_checks?.contexts
                      : [],
                    requiredReviewersCount:
                      bpData?.required_pull_request_reviews
                        ?.required_approving_review_count,
                    requiredCodeownersReviewers:
                      bpData?.required_pull_request_reviews
                        ?.require_code_owner_reviews,
                    enforceAdmins: bpData?.enforce_admins?.enabled,
                    requireSignedCommits: bpData?.required_signatures?.enabled,
                    requireConversationResolution:
                      bpData?.required_conversation_resolution?.enabled,
                  },
                ],
              },
            },
          ],
        },
      };

      return new BranchStrategiesInitializer(branchStrategiesDefault);
    }

    return null;
  }

  async __adaptInitializerBase(_claim: any) {
    return await this.__loadInitializer('defaults_github_repository.yaml');
  }

  async __adaptOverriderRepo(_claim: any) {
    return new GithubRepositoryOverrider();
  }
}
