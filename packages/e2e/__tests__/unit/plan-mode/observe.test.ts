/**
 * Unit: plan-mode observe helpers. No cluster, no GitHub.
 *
 * 1. parsePlanLogLine: PLANNED line -> kind, name, op, +/~/- counts, md path.
 * 2. parsePlanLogLine: non-PLANNED line -> counts undefined.
 * 3. parsePlanLogLine: unrelated line -> undefined.
 * 4. findPlanLogLine: picks the line for one CR among several.
 * 5. assertArtifactMatchesLog: matching counts/op -> pass.
 * 6. assertArtifactMatchesLog: count mismatch -> throw.
 * 7. assertArtifactMatchesLog: op mismatch -> throw.
 * 8. assertPlanned: PLANNED + expected op + non-null plan -> pass; else throw.
 * 9. assertObserveOnly: status and finalizers equal -> pass.
 * 10. assertObserveOnly: status changed -> throw.
 * 11. assertObserveOnly: finalizer removed -> throw.
 */

import {
  assertArtifactMatchesLog,
  assertObserveOnly,
  assertPlanned,
  findPlanLogLine,
  parsePlanLogLine,
  type PlanArtifact,
} from '../../../src/plan-mode/observe';

const PLANNED_LINE =
  'PLAN FirestartrTerraformWorkspace/demo-a CREATED: +3 ~1 -0 (/tmp/plans/FirestartrTerraformWorkspace/demo-a.md)';

function artifact(overrides: Partial<PlanArtifact> = {}): PlanArtifact {
  return {
    kind: 'FirestartrTerraformWorkspace',
    name: 'demo-a',
    operation: 'CREATED',
    result: { status: 'PLANNED', add: 3, change: 1, destroy: 0 },
    plan: { add: 3 },
    ...overrides,
  };
}

describe('plan-mode observe', () => {
  describe('parsePlanLogLine', () => {
    it('parses a PLANNED summary line with counts', () => {
      expect(parsePlanLogLine(PLANNED_LINE)).toEqual({
        kind: 'FirestartrTerraformWorkspace',
        name: 'demo-a',
        operation: 'CREATED',
        counts: { add: 3, change: 1, destroy: 0 },
        artifactMd: '/tmp/plans/FirestartrTerraformWorkspace/demo-a.md',
      });
    });

    it('parses a non-PLANNED line without counts', () => {
      const line =
        'PLAN FirestartrGithubRepository/demo MARKED_TO_DELETION: SKIPPED (parent not provisioned) (/tmp/plans/FirestartrGithubRepository/demo.md)';

      expect(parsePlanLogLine(line)?.counts).toBeUndefined();
    });

    it('ignores unrelated log lines', () => {
      expect(
        parsePlanLogLine('started the operator with options'),
      ).toBeUndefined();
    });
  });

  describe('findPlanLogLine', () => {
    it('finds the line for one CR and operation among many', () => {
      const logs = [
        'PLAN FirestartrTerraformWorkspace/other CREATED: +1 ~0 -0 (/tmp/plans/x.md)',
        PLANNED_LINE,
      ].join('\n');

      expect(
        findPlanLogLine(
          logs,
          'FirestartrTerraformWorkspace',
          'demo-a',
          'CREATED',
        )?.counts,
      ).toEqual({ add: 3, change: 1, destroy: 0 });
      expect(
        findPlanLogLine(
          logs,
          'FirestartrTerraformWorkspace',
          'demo-a',
          'UPDATED',
        ),
      ).toBeUndefined();
    });

    it('returns the latest line for the same CR and operation', () => {
      const logs = [
        PLANNED_LINE,
        PLANNED_LINE.replace('+3 ~1 -0', '+5 ~0 -0'),
      ].join('\n');

      expect(
        findPlanLogLine(
          logs,
          'FirestartrTerraformWorkspace',
          'demo-a',
          'CREATED',
        )?.counts,
      ).toEqual({ add: 5, change: 0, destroy: 0 });
    });
  });

  describe('assertArtifactMatchesLog', () => {
    it('accepts an artifact whose counts match the log line', () => {
      const logLine = parsePlanLogLine(PLANNED_LINE)!;

      expect(() => assertArtifactMatchesLog(artifact(), logLine)).not.toThrow();
    });

    it('rejects counts that differ from the log line', () => {
      const logLine = parsePlanLogLine(PLANNED_LINE)!;
      const drifted = artifact({
        result: { status: 'PLANNED', add: 2, change: 1, destroy: 0 },
      });

      expect(() => assertArtifactMatchesLog(drifted, logLine)).toThrow(
        /do not match log/,
      );
    });

    it('rejects an artifact for another operation', () => {
      const logLine = parsePlanLogLine(PLANNED_LINE)!;

      expect(() =>
        assertArtifactMatchesLog(artifact({ operation: 'UPDATED' }), logLine),
      ).toThrow(/operation/);
    });
  });

  describe('assertPlanned', () => {
    it('requires PLANNED status, the expected operation and a plan', () => {
      expect(() => assertPlanned(artifact(), 'CREATED')).not.toThrow();
      expect(() => assertPlanned(artifact(), 'UPDATED')).toThrow(/operation/);
      expect(() =>
        assertPlanned(
          artifact({ result: { status: 'ERROR' }, plan: null }),
          'CREATED',
        ),
      ).toThrow(/PLANNED/);
      expect(() => assertPlanned(artifact({ plan: null }), 'CREATED')).toThrow(
        /no plan/,
      );
    });
  });

  describe('assertObserveOnly', () => {
    const status = { conditions: [{ type: 'PROVISIONED', status: 'True' }] };

    it('passes when status and finalizers are unchanged', () => {
      expect(() =>
        assertObserveOnly(
          'FirestartrGithubRepository',
          'demo',
          { status, finalizers: ['firestartr.dev/finalizer'] },
          { status: { ...status }, finalizers: ['firestartr.dev/finalizer'] },
        ),
      ).not.toThrow();
    });

    it('fails when a condition changed', () => {
      expect(() =>
        assertObserveOnly(
          'FirestartrGithubRepository',
          'demo',
          { status },
          { status: { conditions: [] } },
        ),
      ).toThrow(/changed status/);
    });

    it('fails when a finalizer was removed', () => {
      expect(() =>
        assertObserveOnly(
          'FirestartrGithubRepository',
          'demo',
          { finalizers: ['firestartr.dev/finalizer'] },
          { finalizers: [] },
        ),
      ).toThrow(/changed finalizers/);
    });
  });
});
