import { describe, expect, it } from '@jest/globals';

import {
  diffClaims,
  formatDiff,
  mutateClaim,
} from '../src/utils/mutateClaim';

import type { FlagSpec, VariantGroup } from '../src/utils/deriveFlags';

const SPECS: FlagSpec[] = [
  { path: 'name', type: 'string', required: true, multiple: false },
  { path: 'description', type: 'string', required: false, multiple: false },
  { path: 'members', type: 'string', required: false, multiple: true },
  { path: 'strategy.name', type: 'string', required: true, multiple: false },
  { path: 'strategy.legacy', type: 'string', required: false, multiple: false },
  { path: 'strategy.modern', type: 'string', required: false, multiple: false },
];

const VARIANTS: VariantGroup[] = [
  {
    discriminatorPath: 'strategy.name',
    variants: { legacy: ['strategy.legacy'], modern: ['strategy.modern'] },
  },
];

describe('mutateClaim', () => {
  it('replaces arrays, unsets fields, and drops stale variant fields', () => {
    const base = {
      name: 'team',
      description: 'old',
      members: ['a', 'b'],
      strategy: { name: 'legacy', legacy: 'old setting' },
    };

    expect(
      mutateClaim(
        base,
        { members: ['c'], 'strategy.name': 'modern' },
        SPECS,
        ['description'],
        VARIANTS,
      ),
    ).toEqual({
      name: 'team',
      members: ['c'],
      strategy: { name: 'modern' },
    });
    expect(base.members).toEqual(['a', 'b']);
  });

  it('rejects unsetting an unconditionally required field', () => {
    expect(() => mutateClaim({ name: 'team' }, {}, SPECS, ['name'])).toThrow(
      'Cannot unset required field: name',
    );
  });

  it('rejects prototype-polluting JSON overrides', () => {
    const specs: FlagSpec[] = [
      { path: 'metadata.json', type: 'string', required: false, multiple: false },
    ];

    expect(() =>
      mutateClaim(
        { metadata: {} },
        { 'metadata.json': '{"__proto__":{"polluted":true}}' },
        specs,
      ),
    ).toThrow('Invalid override key: __proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('claim diff', () => {
  it('reports changed, added, and removed values', () => {
    const diff = diffClaims(
      { name: 'old', removed: true },
      { name: 'new', added: true },
    );

    expect(diff).toEqual([
      { path: 'name', before: 'old', after: 'new' },
      { path: 'removed', before: true, after: undefined },
      { path: 'added', before: undefined, after: true },
    ]);
    expect(JSON.parse(formatDiff(diff, true))).toEqual([
      { path: 'name', before: 'old', after: 'new' },
      { path: 'removed', before: true, after: null },
      { path: 'added', before: null, after: true },
    ]);
  });
});
