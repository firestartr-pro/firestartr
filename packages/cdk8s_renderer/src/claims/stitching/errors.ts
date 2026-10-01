export type StitchingViolationReason =
  | 'protected-path'
  | 'overwrite-protected'
  | 'duplicate-path'
  | 'user-declared-path';

export interface StitchingViolation {
  feature: string;
  op: string;
  path: string;
  reason: StitchingViolationReason;
  conflictingFeature?: string;
  message: string;
}

export class StitchingError extends Error {
  violations: StitchingViolation[];

  constructor(violations: StitchingViolation[]) {
    const lines = violations.map((v) => `  - ${v.message}`).join('\n');
    super(
      `Claim stitching failed with ${violations.length} violation(s):\n${lines}`,
    );
    this.name = 'StitchingError';
    this.violations = violations;
  }
}

export function formatStitchingError(error: StitchingError): string {
  return error.message;
}
