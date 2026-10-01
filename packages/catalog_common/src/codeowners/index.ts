// Common CODEOWNERS machinery (pure TypeScript/data; NO IO, NO classes)
// Strictly follows GitHub CODEOWNERS syntax.
// Design: see packages/catalog_common/docs/adr/0001-codeowners-machinery-is-pure-data.md

import { SimpleTokenizer } from '../tokenizer';

export interface CodeownersEntry {
  type: 'rule' | 'comment' | 'blank';
  pattern?: string;
  owners?: string[];
  raw: string;
}

const OWNER_RE = /^@[\w.-]+(\/[\w.-]+)?$/;

export function parse(raw: string): CodeownersEntry[] {
  if (typeof raw !== 'string' || raw === '') return [];
  return raw.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      return { type: 'blank', raw: line };
    }
    if (/^#/.test(trimmed)) {
      return { type: 'comment', raw: line };
    }
    // Rule line: parse pattern & owners structurally, no ref resolution
    const tokens = trimmed.split(/\s+/);
    const pattern = tokens[0];
    const owners = tokens.slice(1);
    return { type: 'rule', pattern, owners, raw: line };
  });
}

export function format(entries: CodeownersEntry[]): string {
  let end = entries.length;
  while (end > 0 && entries[end - 1].type === 'blank') {
    end -= 1;
  }

  const lines = entries.slice(0, end).map((entry) => {
    switch (entry.type) {
      case 'blank':
        return '';
      case 'comment':
        return entry.raw.trimEnd();
      case 'rule': {
        const owners = entry.owners ?? [];
        return owners.length > 0
          ? `${entry.pattern} ${owners.join(' ')}`
          : `${entry.pattern}`;
      }
    }
  });
  return lines.join('\n') + '\n';
}

export function validate(raw: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) continue;
    if (/^\s*#/.test(line)) continue;

    const tokens = line.trim().split(/\s+/);
    const pattern = tokens[0];
    const owners = tokens.slice(1);

    if (!pattern) {
      errors.push(`Line ${i + 1}: empty pattern`);
      continue;
    }

    if (owners.length === 0) {
      errors.push(`Line ${i + 1}: rule must have at least one owner`);
      continue;
    }

    for (const owner of owners) {
      if (!OWNER_RE.test(owner)) {
        errors.push(
          `Line ${i + 1}: invalid owner '${owner}' (must be @username or @org/team-slug)`,
        );
      }
    }

    if (line.includes('#')) {
      errors.push(`Line ${i + 1}: inline comments are not allowed`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function updateRule(
  entries: CodeownersEntry[],
  pattern: string,
  owners: string[],
): CodeownersEntry[] {
  const idx = entries.findIndex(
    (e) => e.type === 'rule' && e.pattern === pattern,
  );
  const newEntry: CodeownersEntry = {
    type: 'rule',
    pattern,
    owners,
    raw: `${pattern} ${owners.join(' ')}`,
  };
  if (idx >= 0) {
    const result = [...entries];
    result[idx] = newEntry;
    return result;
  }
  return [...entries, newEntry];
}

export function remove(
  entries: CodeownersEntry[],
  pattern: string,
): CodeownersEntry[] {
  return entries.filter((e) => !(e.type === 'rule' && e.pattern === pattern));
}

export function getOwners(entries: CodeownersEntry[]): string[] {
  const owners = new Set<string>();
  for (const entry of entries) {
    if (entry.type === 'rule' && entry.owners) {
      for (const owner of entry.owners) {
        owners.add(owner);
      }
    }
  }
  return [...owners];
}

export function resolveRefs(
  raw: string,
  replacements: Record<string, string>,
): string {
  const tokenizer = new SimpleTokenizer(/\{\{\s*([\w./-]+)\s*\}\}/);
  return tokenizer.replace(raw, (token) => {
    const key = token.groups?.[0] ?? '';
    return key in replacements ? replacements[key] : token.value;
  });
}

export default {
  parse,
  format,
  validate,
  updateRule,
  remove,
  getOwners,
  resolveRefs,
};
