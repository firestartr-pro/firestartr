import { NameNormalizer } from './name';
import { RefValuesNormalizer } from './refValues';
import { RevisionNormalizer } from './RevisionNormalizer';
import { TFWorkspaceNormalizer } from './tfworkspace';
export { normalizeModuleContent } from './tfworkspace';

export const NORMALIZERS: any[] = [
  NameNormalizer,
  RefValuesNormalizer,
  TFWorkspaceNormalizer,
  RevisionNormalizer,
];
