import {
  buildMassivePlan,
  parseMassiveConfig,
  splitBatches,
} from '../../src/massive-plan';

describe('massive e2e plan', () => {
  it('uses final default scale', () => {
    expect(parseMassiveConfig({})).toMatchObject({
      repoCount: 50,
      groupCount: 10,
      disableSleepGuards: false,
    });
  });

  it('supports count overrides for validation runs', () => {
    expect(
      parseMassiveConfig({
        E2E_MASSIVE_REPO_COUNT: '25',
        E2E_MASSIVE_GROUP_COUNT: '5',
      }),
    ).toMatchObject({
      repoCount: 25,
      groupCount: 5,
    });
  });

  it('rejects invalid positive integer values', () => {
    expect(() =>
      parseMassiveConfig({ E2E_MASSIVE_REPO_BATCH_SIZE: '0' }),
    ).toThrow('E2E_MASSIVE_REPO_BATCH_SIZE must be a positive integer');
  });

  it('allows zero pause and stagger overrides', () => {
    expect(
      parseMassiveConfig({
        E2E_MASSIVE_REPO_BATCH_PAUSE_MS: '0',
        E2E_MASSIVE_REPO_APPLY_STAGGER_MS: '0',
      }),
    ).toMatchObject({
      repoBatchPauseMs: 0,
      repoApplyStaggerMs: 0,
    });
  });

  it('parses disabled sleeping guards flag', () => {
    expect(
      parseMassiveConfig({ E2E_MASSIVE_DISABLE_SLEEP_GUARDS: 'true' }),
    ).toMatchObject({ disableSleepGuards: true });
    expect(
      parseMassiveConfig({ E2E_MASSIVE_DISABLE_SLEEP_GUARDS: '1' }),
    ).toMatchObject({ disableSleepGuards: true });
    expect(
      parseMassiveConfig({ E2E_MASSIVE_DISABLE_SLEEP_GUARDS: 'false' }),
    ).toMatchObject({ disableSleepGuards: false });
    expect(
      parseMassiveConfig({ E2E_MASSIVE_DISABLE_SLEEP_GUARDS: '0' }),
    ).toMatchObject({ disableSleepGuards: false });
  });

  it('rejects invalid disabled sleeping guards flag values', () => {
    expect(() =>
      parseMassiveConfig({ E2E_MASSIVE_DISABLE_SLEEP_GUARDS: 'yes' }),
    ).toThrow(
      'E2E_MASSIVE_DISABLE_SLEEP_GUARDS must be a boolean flag (true/false/1/0)',
    );
  });

  it('builds deterministic names and round-robin owners', () => {
    const plan = buildMassivePlan('massive-e2e', 4, 2);

    expect(plan.groups.map((group) => group.claimName)).toEqual([
      'massive-e2e-group-001',
      'massive-e2e-group-002',
    ]);
    expect(
      plan.repositories.map((repository) => [
        repository.claimName,
        repository.ownerRef,
      ]),
    ).toEqual([
      ['massive-e2e-repo-001', 'group:massive-e2e-group-001'],
      ['massive-e2e-repo-002', 'group:massive-e2e-group-002'],
      ['massive-e2e-repo-003', 'group:massive-e2e-group-001'],
      ['massive-e2e-repo-004', 'group:massive-e2e-group-002'],
    ]);
    expect(plan.repositories[0]?.features).toEqual([
      { name: 'tech_docs', version: '0.10.2' },
    ]);
    expect(plan.canary.modified).toMatchObject({
      claimName: 'massive-e2e-canary',
      topics: ['massive-e2e', 'canary', 'modified'],
      features: [{ name: 'tech_docs', version: '0.10.2' }],
    });
  });

  it('uses the plan prefix in repository topics', () => {
    const plan = buildMassivePlan('custom-e2e', 1, 1);

    expect(plan.repositories[0]?.topics).toEqual(['custom-e2e', 'repo-001']);
    expect(plan.canary.create.topics).toEqual(['custom-e2e', 'canary']);
    expect(plan.canary.modified.topics).toEqual([
      'custom-e2e',
      'canary',
      'modified',
    ]);
  });

  it('splits batches predictably', () => {
    expect(splitBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
