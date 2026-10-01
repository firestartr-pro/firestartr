import * as fs from 'node:fs';
import YAML from 'yaml';

export interface CrdDiagnostics {
  observed: string[];
  missing: string[];
}

/**
 * Read the host diagnostic file produced by the e2e global collector and
 * return the most-recent CRD diagnostics section if present.
 */
export function getLatestCrdDiagnostics(
  hostFilePath = '/tmp/diagnosis',
): CrdDiagnostics | null {
  try {
    if (!fs.existsSync(hostFilePath)) return null;
    const raw = fs.readFileSync(hostFilePath, { encoding: 'utf-8' });

    // The host file contains multiple YAML documents separated by `---` and
    // an initial comment header. Split by the document separator and parse
    // each document; return the last one that contains a `crds` top-level
    // key.
    const parts = raw
      .split(/^---$/m)
      .map((p) => p.trim())
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const doc = parts[i].replace(/^#.*$/gm, '').trim();
      if (!doc) continue;
      try {
        const parsed = YAML.parse(doc) as any;
        if (parsed && typeof parsed === 'object' && parsed.crds) {
          const crds = parsed.crds as any;
          const observed = Array.isArray(crds.observed)
            ? crds.observed.map(String)
            : [];
          const missing = Array.isArray(crds.missing)
            ? crds.missing.map(String)
            : [];
          return { observed, missing };
        }
      } catch {
        // ignore parse errors for individual docs
      }
    }

    return null;
  } catch (err) {
    return null;
  }
}

export function readAllDiagnostics(hostFilePath = '/tmp/diagnosis'): any[] {
  try {
    if (!fs.existsSync(hostFilePath)) return [];
    const raw = fs.readFileSync(hostFilePath, { encoding: 'utf-8' });
    const parts = raw
      .split(/^---$/m)
      .map((p) => p.trim())
      .filter(Boolean);
    const out: any[] = [];
    for (const part of parts) {
      try {
        const doc = part.replace(/^#.*$/gm, '').trim();
        if (!doc) continue;
        const parsed = YAML.parse(doc);
        out.push(parsed);
      } catch {
        // ignore
      }
    }
    return out;
  } catch {
    return [];
  }
}

export default { getLatestCrdDiagnostics, readAllDiagnostics };
