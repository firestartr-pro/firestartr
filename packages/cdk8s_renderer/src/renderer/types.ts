import { ApiObject } from 'cdk8s';
import { GlobalSection } from '../globals/base';
import { Normalizer } from '../normalizers/base';
import { OverriderPatches } from '../overriders/base';

export type RenderClaimData = {
  claim: any;

  claimPath?: string;

  initializers: any[];

  overrides: OverriderPatches[];

  globals: GlobalSection[];

  normalizers: Normalizer[];
};

type ClaimKind = string;
type ClaimName = string;
export type RenderClaimKey = `${ClaimKind}-${ClaimName}`;

type CRKind = string;
type CRName = string;
type RenderCRKey = `${CRKind}-${CRName}`;

export type RenderedCrMap = {
  [key: RenderCRKey]: ApiObject;
};

export type RenderClaims = {
  [key: RenderClaimKey]: RenderClaimData;
};
