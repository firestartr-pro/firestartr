import { RenderClaimData, RenderClaims } from '../../renderer/types';
import { IClaim } from '../base';
import { IGroupClaim } from '../base/group';

const PRECALCULATED_VIRTUAL_CLAIMS = {};

export function initVirtualClaims(org: string) {
  if (Object.keys(PRECALCULATED_VIRTUAL_CLAIMS).length !== 0) return;

  PRECALCULATED_VIRTUAL_CLAIMS[`GroupClaim-${org}-all`] = FirestartrAllClaim;
}

export function isVirtualClaim(kind: string, name: string): boolean {
  return (
    Object.keys(PRECALCULATED_VIRTUAL_CLAIMS).indexOf(`${kind}-${name}`) !== -1
  );
}

export function getVirtualClaim(kind: string, name: string) {
  if (
    Object.keys(PRECALCULATED_VIRTUAL_CLAIMS).indexOf(`${kind}-${name}`) !== -1
  ) {
    return new PRECALCULATED_VIRTUAL_CLAIMS[`${kind}-${name}`]();
  }

  return null;
}

export interface IVirtualClaim {
  expand(config?: any): Promise<IClaim>;
  getDefaultConfig(): any;
}

export class FirestartrAllClaim implements IVirtualClaim {
  DEFAULT_CONFIG: any = {
    kind: 'FirestartrGithubGroup',
    defaultValues: {
      context: {
        backend: {
          ref: {
            kind: 'FirestartrProviderConfig',
            name: 'firestartr-terraform-state',
          },
        },

        provider: {
          ref: {
            kind: 'FirestartrProviderConfig',
            name: 'github-app',
          },
        },
      },
    },
  };

  async expand(config: any = {}): Promise<IClaim> {
    const { org }: any = config;

    const groupClaim: IGroupClaim = {
      kind: 'GroupClaim',

      version: '1.0',

      children: [],

      name: `${org}-all`,

      description: 'Firestartr group with all org members',

      type: 'business-unit',

      profile: {
        displayName: 'firestartr-all',

        email: 'firestartr-all@firestartr.dev',

        picture: 'https://example.com/groups/bu-infrastructure.jpeg',
      },

      members: [],

      providers: {
        github: {
          name: `${org}-all`,

          privacy: 'closed',

          org,
        },
      },
    };

    return groupClaim;
  }

  expandMembers(renderClaims: RenderClaims): string[] {
    return Object.values(renderClaims)
      .filter((renderClaimData: RenderClaimData) => {
        return renderClaimData.claim.kind === 'UserClaim';
      })
      .sort((a, b) => {
        const claimAName = a.claim.name;
        const claimBName = b.claim.name;

        if (claimAName > claimBName) {
          return 1;
        }

        if (claimAName < claimBName) {
          return -1;
        }

        return 0;
      })
      .map((renderClaimData: RenderClaimData) => {
        return `user:${renderClaimData.claim.name}`;
      });
  }

  getDefaultConfig(): any {
    return this.DEFAULT_CONFIG;
  }
}
