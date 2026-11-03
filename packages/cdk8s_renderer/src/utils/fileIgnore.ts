import { existsSync } from 'node:fs';
import path from 'node:path';

export const FIRESTARTR_IGNORE_FILE = '.firestartrignore';

/** Only the file's own directory matters; markers are not inherited. */
export function isIgnoredFile(file: string): boolean {
  return (
    /\.(yaml|yml)$/.test(file) &&
    existsSync(path.join(path.dirname(file), FIRESTARTR_IGNORE_FILE))
  );
}
