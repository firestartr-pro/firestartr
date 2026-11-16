import { OperationType } from '../src/definitions';
import { planStartupOperation } from '../src/plan-mode/startup';

function cr(conditions: any[]) {
  return {
    kind: 'FirestartrTerraformWorkspace',
    metadata: { name: 'ws', generation: 2 },
    status: { conditions },
  };
}

describe('planStartupOperation', () => {
  it('audits an already provisioned CR as NOTHING', () => {
    const item = cr([
      { type: 'PROVISIONED', status: 'True', observedGeneration: 2 },
    ]);

    expect(planStartupOperation(item)).toBe(OperationType.NOTHING);
  });

  it('audits a CR with an active ERROR as the live retry', () => {
    expect(
      planStartupOperation(
        cr([{ type: 'ERROR', status: 'True', reason: 'UPDATED' }]),
      ),
    ).toBe(OperationType.RETRY);

    expect(
      planStartupOperation(
        cr([{ type: 'ERROR', status: 'True', reason: 'SYNC' }]),
      ),
    ).toBe(OperationType.RETRY_SYNC);
  });

  it('ignores an inactive ERROR condition', () => {
    expect(
      planStartupOperation(cr([{ type: 'ERROR', status: 'False' }])),
    ).toBe(OperationType.NOTHING);
  });
});
