import { parse, format, validate, updateRule, remove, getOwners, resolveRefs } from '../src/codeowners';

describe('codeowners', () => {
  const SAMPLE = [
    '# This is a CODEOWNERS file',
    '',
    '* @org/default-team',
    '/src/** @org/frontend-team @user1',
    '/docs/** @org/docs-team',
  ].join('\n');

  describe('parse', () => {
    it('parses comments, blanks, and rules', () => {
      const entries = parse(SAMPLE);
      expect(entries).toHaveLength(5);
      expect(entries[0]).toEqual({ type: 'comment', raw: '# This is a CODEOWNERS file' });
      expect(entries[1]).toEqual({ type: 'blank', raw: '' });
      expect(entries[2]).toEqual({ type: 'rule', pattern: '*', owners: ['@org/default-team'], raw: '* @org/default-team' });
      expect(entries[3]).toEqual({ type: 'rule', pattern: '/src/**', owners: ['@org/frontend-team', '@user1'], raw: '/src/** @org/frontend-team @user1' });
      expect(entries[4]).toEqual({ type: 'rule', pattern: '/docs/**', owners: ['@org/docs-team'], raw: '/docs/** @org/docs-team' });
    });

    it('returns empty array for empty input', () => {
      expect(parse('')).toEqual([]);
    });

    it('handles comments-only file', () => {
      const entries = parse('# comment 1\n# comment 2');
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.type === 'comment')).toBe(true);
    });
  });

  describe('format', () => {
    it('produces canonical output from parsed entries', () => {
      const entries = parse(SAMPLE);
      const output = format(entries);
      expect(output).toBe(
        '# This is a CODEOWNERS file\n\n* @org/default-team\n/src/** @org/frontend-team @user1\n/docs/** @org/docs-team\n',
      );
    });

    it('normalizes extra whitespace in rules', () => {
      const entries = parse('*   @org/team1    @org/team2');
      const output = format(entries);
      expect(output).toBe('* @org/team1 @org/team2\n');
    });

    it('produces single trailing newline', () => {
      const output = format(parse('# just a comment'));
      expect(output.endsWith('\n')).toBe(true);
      expect(output.endsWith('\n\n')).toBe(false);
    });

    it('produces single trailing newline when input already ends with newline', () => {
      const output = format(parse(SAMPLE + '\n'));
      expect(output.endsWith('\n')).toBe(true);
      expect(output.endsWith('\n\n')).toBe(false);
    });
  });

  describe('validate', () => {
    it('returns valid for well-formed input', () => {
      const result = validate(SAMPLE);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns valid for comments-only file', () => {
      const result = validate('# just comments\n# another');
      expect(result.valid).toBe(true);
    });

    it('returns valid for empty file', () => {
      const result = validate('');
      expect(result.valid).toBe(true);
    });

    it('errors on rule without owners', () => {
      const result = validate('/src/**');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least one owner');
    });

    it('errors on invalid owner format', () => {
      const result = validate('/src/** notanowner');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('invalid owner');
    });

    it('errors on inline comments', () => {
      const result = validate('/src/** @org/team # inline comment');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('inline comments'))).toBe(true);
    });
  });

  describe('updateRule', () => {
    it('replaces owners for existing pattern', () => {
      const entries = parse(SAMPLE);
      const updated = updateRule(entries, '/docs/**', ['@org/new-team']);
      const docRule = updated.find((e) => e.pattern === '/docs/**');
      expect(docRule?.owners).toEqual(['@org/new-team']);
    });

    it('appends new rule if pattern not found', () => {
      const entries = parse(SAMPLE);
      const updated = updateRule(entries, '/api/**', ['@org/api-team']);
      expect(updated).toHaveLength(entries.length + 1);
      expect(updated[updated.length - 1]).toEqual({
        type: 'rule',
        pattern: '/api/**',
        owners: ['@org/api-team'],
        raw: '/api/** @org/api-team',
      });
    });
  });

  describe('remove', () => {
    it('removes rule by pattern', () => {
      const entries = parse(SAMPLE);
      const result = remove(entries, '/docs/**');
      expect(result.find((e) => e.pattern === '/docs/**')).toBeUndefined();
      expect(result).toHaveLength(entries.length - 1);
    });

    it('returns unchanged entries if pattern not found', () => {
      const entries = parse(SAMPLE);
      const result = remove(entries, '/nonexistent/**');
      expect(result).toEqual(entries);
    });
  });

  describe('getOwners', () => {
    it('returns unique owners', () => {
      const entries = parse(SAMPLE);
      const owners = getOwners(entries);
      expect(owners.sort()).toEqual(['@org/default-team', '@org/docs-team', '@org/frontend-team', '@user1'].sort());
    });

    it('returns empty array for no rules', () => {
      const entries = parse('# just a comment');
      expect(getOwners(entries)).toEqual([]);
    });
  });

  describe('resolveRefs', () => {
    it('resolves references using SimpleTokenizer', () => {
      const raw = '* {{ default_team }}\n/src/** {{ frontend_team }}';
      const result = resolveRefs(raw, {
        default_team: '@org/platform',
        frontend_team: '@org/frontend',
      });
      expect(result).toBe('* @org/platform\n/src/** @org/frontend');
    });

    it('leaves unmatched references untouched', () => {
      const raw = '* {{ unknown_ref }}';
      const result = resolveRefs(raw, {});
      expect(result).toBe('* {{ unknown_ref }}');
    });

    it('handles multiple refs on same line', () => {
      const raw = '/src/** {{ team1 }} {{ team2 }}';
      const result = resolveRefs(raw, { team1: '@org/a', team2: '@org/b' });
      expect(result).toBe('/src/** @org/a @org/b');
    });
  });
});
