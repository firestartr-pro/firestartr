export class Cr {
  kind: string;
  metadata: {
    name: string;
    annotations: {
      [key: string]: string;
    };
  };

  status: {
    conditions: {
      type: string;
      status: string;
      message: string;
    }[];
  };

  constructor(
    kind: string,

    metadata: {
      name: string;
      annotations: { [key: string]: string };
    },

    conditions: {
      type: string;
      status: string;
      message: string;
    }[],
  ) {
    this.kind = kind;
    this.metadata = metadata;
    this.status = { conditions };
  }

  hasCondition(type: string, status: string) {
    return this.status.conditions.find(
      (c) => c.type === type && c.status === status,
    );
  }

  hasError() {
    return this.hasCondition('ERROR', 'True');
  }

  isDrifted() {
    return this.hasCondition('OUT_OF_SYNC', 'True');
  }

  get driftMessage() {
    return (
      this.status.conditions.find((c) => c.type === 'LAST_PLAN_DETAILS')
        ?.message || ''
    );
  }

  get errorMessage() {
    return (
      this.status.conditions.find((c) => c.type === 'ERROR')?.message || ''
    );
  }

  get claimName() {
    return this.metadata.annotations['firestartr.dev/claim-ref'].split('/')[1];
  }

  get claimKind() {
    return this.metadata.annotations['firestartr.dev/claim-ref'].split('/')[0];
  }
}
