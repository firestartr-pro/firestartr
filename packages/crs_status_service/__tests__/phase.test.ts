import { derivePhase } from '../src/phase';

describe('derivePhase', () => {
  it('returns UNKNOWN when conditions is empty', () => {
    expect(derivePhase([])).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when no condition has status True', () => {
    expect(
      derivePhase([
        { type: 'PROVISIONED', status: 'False' },
        { type: 'SYNCHRONIZED', status: 'False' },
      ]),
    ).toBe('UNKNOWN');
  });

  it('picks the highest-priority True condition', () => {
    expect(
      derivePhase([
        { type: 'SYNCHRONIZED', status: 'True' },
        { type: 'OUT_OF_SYNC', status: 'True' },
        { type: 'PROVISIONED', status: 'True' },
      ]),
    ).toBe('OUT_OF_SYNC');
  });

  it('ERROR always wins over lower-priority conditions', () => {
    expect(
      derivePhase([
        { type: 'SYNCHRONIZED', status: 'True' },
        { type: 'ERROR', status: 'True' },
        { type: 'PROVISIONED', status: 'True' },
      ]),
    ).toBe('ERROR');
  });

  it('treats unlisted types as lowest priority', () => {
    expect(derivePhase([{ type: 'NOTHING', status: 'True' }])).toBe('NOTHING');
  });

  it('regression: PROVISIONED True, SYNCHRONIZED True — no highPriorityState', () => {
    // CR that is provisioned and synced but operator hasn't re-written status
    // since highPriorityState was added. SYNCHRONIZED (idx 5) beats PROVISIONED (idx 6).
    expect(
      derivePhase([
        { type: 'PROVISIONED', status: 'True' },
        { type: 'SYNCHRONIZED', status: 'True' },
      ]),
    ).toBe('SYNCHRONIZED');
  });

  it('regression: only PROVISIONED True — no highPriorityState', () => {
    // CR that reached PROVISIONED but never SYNCHRONIZED, e.g. a static kind
    // without post-provision sync. Previously resolved to UNKNOWN.
    expect(
      derivePhase([
        { type: 'PROVISIONED', status: 'True' },
        { type: 'SYNCHRONIZED', status: 'False' },
      ]),
    ).toBe('PROVISIONED');
  });
});
