import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getLatestCrdDiagnostics,
  readAllDiagnostics,
} from '../../src/diagnostics';

function writeTempDiagnosis(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-diag-'));
  const file = path.join(dir, 'diagnosis');
  fs.writeFileSync(file, content, { encoding: 'utf-8' });
  return file;
}

describe('e2e diagnostics parser', () => {
  it('returns null when file missing', () => {
    const tmp = path.join(os.tmpdir(), `no-such-file-${Date.now()}.diag`);
    const res = getLatestCrdDiagnostics(tmp);
    expect(res).toBeNull();
  });

  it('parses the latest crds block from appended YAML snapshots', () => {
    const doc1 = `# header\n timestamp: "2026-01-01T00:00:00Z"\n env:\n   OPERATOR_KIND_LIST: githubgroups\n`;
    const doc2 = `---\n# collected at later\ncrds:\n  observed:\n    - FirestartrDummyA\n  missing:\n    - default/fsdummiesa\n`;
    const doc3 = `---\n# collected at final\ncrds:\n  observed:\n    - FirestartrDummyA\n    - FirestartrDummyB\n  missing:\n    - default/otherplural\n`;

    const file = writeTempDiagnosis(doc1 + '\n' + doc2 + '\n' + doc3 + '\n');

    const latest = getLatestCrdDiagnostics(file);
    expect(latest).not.toBeNull();
    expect(latest?.observed).toEqual(['FirestartrDummyA', 'FirestartrDummyB']);
    expect(latest?.missing).toEqual(['default/otherplural']);

    const all = readAllDiagnostics(file);
    expect(Array.isArray(all)).toBe(true);
    // should contain at least one parsed doc with crds
    const hasCrd = all.some(
      (d) => d && typeof d === 'object' && (d as any).crds,
    );
    expect(hasCrd).toBe(true);
  });
});
