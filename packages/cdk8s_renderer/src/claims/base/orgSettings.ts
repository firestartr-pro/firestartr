import { IClaim } from '../base';

export interface IOrgSettingsClaim extends IClaim {
  providers: object;
}

export const schema = 'firestartr.dev://common/OrgSettingsClaim';
