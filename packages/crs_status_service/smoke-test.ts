import { KubeConfig, CustomObjectsApi } from '@kubernetes/client-node';

const API_GROUP = 'firestartr.dev';
const API_VERSION = 'v1';
const NAMESPACE = 'default';
const DUMMY_PLURALS = ['fsdummiesa', 'fsdummiesb', 'fsdummiesc'];

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface Report {
  passed: boolean;
  timestamp: string;
  summary: string;
  checks: CheckResult[];
}

interface StatusProjection {
  kind: string;
  name: string;
  phase: string;
  [key: string]: unknown;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: { baseUrl: string; waitCreate: number; waitDelete: number } = {
    baseUrl: 'http://localhost:9091',
    waitCreate: 20,
    waitDelete: 25,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && i + 1 < args.length)
      opts.baseUrl = args[++i];
    if (args[i] === '--wait-create' && i + 1 < args.length)
      opts.waitCreate = parseInt(args[++i], 10);
    if (args[i] === '--wait-delete' && i + 1 < args.length)
      opts.waitDelete = parseInt(args[++i], 10);
  }
  return opts;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function checkHealth(baseUrl: string): Promise<CheckResult> {
  const name = 'service_health';
  try {
    const body: any = await fetchJson(`${baseUrl}/health`);
    if (body.healthy === true) {
      return {
        name,
        passed: true,
        detail: `GET /health returned healthy:true (live=${body.liveCount}, tombstones=${body.tombstoneCount})`,
      };
    }
    return {
      name,
      passed: false,
      detail: `GET /health returned healthy:${body.healthy}`,
    };
  } catch (err: any) {
    return {
      name,
      passed: false,
      detail: `GET /health failed: ${err.message}`,
    };
  }
}

async function checkStatusHasProjections(
  baseUrl: string,
  expectedCount: number,
): Promise<{ check: CheckResult; projections: StatusProjection[] }> {
  const name = 'status_has_projections';
  try {
    const body = (await fetchJson(`${baseUrl}/status`)) as StatusProjection[];
    if (body.length >= expectedCount) {
      const kinds = body.map((p) => `${p.kind}/${p.name}`).join(', ');
      return {
        check: {
          name,
          passed: true,
          detail: `GET /status returned ${body.length} projections (≥${expectedCount}): ${kinds}`,
        },
        projections: body,
      };
    }
    return {
      check: {
        name,
        passed: false,
        detail: `GET /status returned ${body.length} projections, expected ≥${expectedCount}`,
      },
      projections: body,
    };
  } catch (err: any) {
    return {
      check: {
        name,
        passed: false,
        detail: `GET /status failed: ${err.message}`,
      },
      projections: [],
    };
  }
}

async function checkPhasePassThrough(
  projections: StatusProjection[],
  kc: KubeConfig,
): Promise<CheckResult> {
  const name = 'phase_pass_through';
  const api = kc.makeApiClient(CustomObjectsApi);
  const mismatches: string[] = [];

  for (const plural of DUMMY_PLURALS) {
    try {
      const resp = await api.listNamespacedCustomObject({
        group: API_GROUP,
        version: API_VERSION,
        namespace: NAMESPACE,
        plural,
      });
      const items: any[] = (resp as any)?.body?.items || [];
      for (const item of items) {
        const kind: string = item.kind || '';
        const name: string = item.metadata?.name || '';
        const actualPhase: string = item.status?.highPriorityState || 'UNKNOWN';
        const projection = projections.find(
          (p) => p.kind === kind && p.name === name,
        );
        if (!projection) {
          mismatches.push(`${kind}/${name}: not found in service projections`);
          continue;
        }
        if (projection.phase !== actualPhase) {
          mismatches.push(
            `${kind}/${name}: service says "${projection.phase}", CR says "${actualPhase}"`,
          );
        }
      }
    } catch (err: any) {
      mismatches.push(`Failed to list ${plural}: ${err.message}`);
    }
  }

  if (mismatches.length === 0) {
    return {
      name,
      passed: true,
      detail: `All ${projections.length} projections match CR status.highPriorityState`,
    };
  }
  return { name, passed: false, detail: mismatches.join('; ') };
}

async function deleteAllDummies(kc: KubeConfig): Promise<void> {
  const api = kc.makeApiClient(CustomObjectsApi);
  for (const plural of DUMMY_PLURALS) {
    try {
      const resp = await api.listNamespacedCustomObject({
        group: API_GROUP,
        version: API_VERSION,
        namespace: NAMESPACE,
        plural,
      });
      const items: any[] = (resp as any)?.body?.items || [];
      for (const item of items) {
        const name: string = item.metadata?.name || '';
        try {
          await api.deleteNamespacedCustomObject({
            group: API_GROUP,
            version: API_VERSION,
            namespace: NAMESPACE,
            plural,
            name,
          });
        } catch {
          // already deleting or gone
        }
      }
    } catch {
      // nothing to delete
    }
  }
}

async function waitForAllDeleted(
  kc: KubeConfig,
  timeoutMs: number,
): Promise<{ deleted: boolean; remaining: number }> {
  const api = kc.makeApiClient(CustomObjectsApi);
  const deadline = Date.now() + timeoutMs;
  let total = 0;

  while (Date.now() < deadline) {
    total = 0;
    for (const plural of DUMMY_PLURALS) {
      try {
        const resp = await api.listNamespacedCustomObject({
          group: API_GROUP,
          version: API_VERSION,
          namespace: NAMESPACE,
          plural,
        });
        total += (((resp as any)?.body?.items || []) as any[]).length;
      } catch {
        // may 404 if CRD is gone — unlikely for dummies
      }
    }
    if (total === 0) return { deleted: true, remaining: 0 };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { deleted: false, remaining: total };
}

async function checkTombstonesAfterDelete(
  baseUrl: string,
  expectedCount: number,
  retryMs = 10000,
): Promise<CheckResult> {
  const name = 'tombstones_after_delete';
  const deadline = Date.now() + retryMs;

  while (Date.now() < deadline) {
    try {
      const body = (await fetchJson(`${baseUrl}/status`)) as StatusProjection[];
      const deleted = body.filter((p) => p.phase === 'DELETED');
      if (deleted.length >= expectedCount) {
        const names = deleted.map((p) => `${p.kind}/${p.name}`).join(', ');
        return {
          name,
          passed: true,
          detail: `GET /status returned ${deleted.length} DELETED tombstones (≥${expectedCount}): ${names}`,
        };
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Final check for the report detail
  try {
    const body = (await fetchJson(`${baseUrl}/status`)) as StatusProjection[];
    const deleted = body.filter((p) => p.phase === 'DELETED');
    return {
      name,
      passed: false,
      detail: `GET /status returned ${deleted.length} DELETED tombstones, expected ≥${expectedCount} (after ${retryMs / 1000}s)`,
    };
  } catch (err: any) {
    return {
      name,
      passed: false,
      detail: `GET /status after delete failed: ${err.message}`,
    };
  }
}

async function main() {
  const opts = parseArgs();
  const checks: CheckResult[] = [];
  const kc = new KubeConfig();
  kc.loadFromDefault();

  // Phase 1: health check
  checks.push(await checkHealth(opts.baseUrl));

  // Phase 2: status has projections (expected: 2xA + 1xB + 1xC = 4)
  const { check: statusCheck, projections } = await checkStatusHasProjections(
    opts.baseUrl,
    4,
  );
  checks.push(statusCheck);

  // Phase 3: compare phases with actual CR status
  if (statusCheck.passed) {
    checks.push(await checkPhasePassThrough(projections, kc));
  } else {
    checks.push({
      name: 'phase_pass_through',
      passed: false,
      detail: 'Skipped — no projections to compare',
    });
  }

  // Phase 4: delete all dummies
  await deleteAllDummies(kc);
  console.error(
    `Waiting ${opts.waitDelete}s for operator to process deletions...`,
  );
  const deleteResult = await waitForAllDeleted(kc, opts.waitDelete * 1000);

  if (deleteResult.deleted) {
    checks.push({
      name: 'cr_deletion',
      passed: true,
      detail: `All dummies deleted within ${opts.waitDelete}s`,
    });
  } else {
    checks.push({
      name: 'cr_deletion',
      passed: false,
      detail: `Some dummies not deleted within ${opts.waitDelete}s`,
    });
  }

  // Phase 5: tombstones appear in service
  checks.push(await checkTombstonesAfterDelete(opts.baseUrl, 4));

  // Phase 6: health after deletion
  checks.push(await checkHealth(opts.baseUrl));

  // Build report
  const allPassed = checks.every((c) => c.passed);
  const failCount = checks.filter((c) => !c.passed).length;
  const report: Report = {
    passed: allPassed,
    timestamp: new Date().toISOString(),
    summary: allPassed
      ? 'All checks passed'
      : `${failCount}/${checks.length} checks failed`,
    checks,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  const report: Report = {
    passed: false,
    timestamp: new Date().toISOString(),
    summary: `Fatal error: ${err.message}`,
    checks: [{ name: 'fatal', passed: false, detail: err.message }],
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
});
