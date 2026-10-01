import { IClaim } from '.';

export interface IGroupClaim extends IClaim {
  description: string;
  type: 'business-unit' | 'team';
  profile: {
    displayName: string;
    email: string;
    picture: string;
  };
  parent?: string;
  members: string[];
  children: string[];
  providers: any;
}

export const schema = 'firestartr.dev://common/GroupClaim';
