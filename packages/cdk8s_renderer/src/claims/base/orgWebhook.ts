import { IClaim } from '../base';

export interface IOrgWebhookClaim extends IClaim {
  org: string;
  displayName: string;
  system?: string;
  owner: string;
  providers: object;
}

export const schema = 'firestartr.dev://common/OrgWebhookClaim';
