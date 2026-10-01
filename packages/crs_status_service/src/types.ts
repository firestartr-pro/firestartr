export interface Condition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface StatusProjection {
  kind: string;
  name: string;
  namespace: string;
  claimKind: string | null;
  claimName: string | null;
  phase: string;
  conditions: Condition[];
  observedAt: string;
}
