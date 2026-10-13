import { describe, it, expect } from '@jest/globals';
import { buildClaimFromFlags } from '../src/utils/buildClaim';
import type { FlagSpec } from '../src/utils/deriveFlags';

describe('buildClaimFromFlags', () => {
  it('builds a flat claim from simple flags', () => {
    const specs: FlagSpec[] = [
      { path: 'name', type: 'string', required: true, multiple: false },
      { path: 'kind', type: 'string', required: true, multiple: false },
    ];

    const claim = buildClaimFromFlags(
      { name: 'my-component', kind: 'ComponentClaim' },
      specs,
    );

    expect(claim).toEqual({ name: 'my-component', kind: 'ComponentClaim' });
  });

  it('builds nested object from dotted flag paths', () => {
    const specs: FlagSpec[] = [
      {
        path: 'providers.github.name',
        type: 'string',
        required: true,
        multiple: false,
      },
      {
        path: 'providers.github.visibility',
        type: 'string',
        required: true,
        multiple: false,
      },
      {
        path: 'providers.github.org',
        type: 'string',
        required: true,
        multiple: false,
      },
    ];

    const claim = buildClaimFromFlags(
      {
        'providers.github.name': 'my-repo',
        'providers.github.visibility': 'private',
        'providers.github.org': 'my-org',
      },
      specs,
    );

    expect(claim).toEqual({
      providers: {
        github: {
          name: 'my-repo',
          visibility: 'private',
          org: 'my-org',
        },
      },
    });
  });

  it('ignores null and undefined flag values', () => {
    const specs: FlagSpec[] = [
      { path: 'name', type: 'string', required: true, multiple: false },
      { path: 'description', type: 'string', required: false, multiple: false },
    ];

    const claim = buildClaimFromFlags(
      { name: 'foo', description: null, unused: 'ignored' },
      specs,
    );

    expect(claim).toEqual({ name: 'foo' });
  });

  it('handles boolean flags', () => {
    const specs: FlagSpec[] = [
      {
        path: 'archiveOnDestroy',
        type: 'boolean',
        required: false,
        multiple: false,
      },
      { path: 'hasIssues', type: 'boolean', required: false, multiple: false },
    ];

    const claim = buildClaimFromFlags(
      { archiveOnDestroy: true, hasIssues: false },
      specs,
    );

    expect(claim).toEqual({ archiveOnDestroy: true, hasIssues: false });
  });

  it('handles multiple (array) flags', () => {
    const specs: FlagSpec[] = [
      { path: 'topics', type: 'string', required: false, multiple: true },
      { path: 'maintainedBy', type: 'string', required: false, multiple: true },
    ];

    const claim = buildClaimFromFlags(
      { topics: ['api', 'backend'], maintainedBy: ['group:devops'] },
      specs,
    );

    expect(claim).toEqual({
      topics: ['api', 'backend'],
      maintainedBy: ['group:devops'],
    });
  });

  it('ignores flag values whose paths have no matching spec', () => {
    const specs: FlagSpec[] = [
      { path: 'name', type: 'string', required: true, multiple: false },
    ];

    const claim = buildClaimFromFlags(
      { name: 'foo', unknownFlag: 'bar', anotherOne: 42 },
      specs,
    );

    expect(claim).toEqual({ name: 'foo' });
  });

  it('handles numerical values', () => {
    const specs: FlagSpec[] = [
      { path: 'replicas', type: 'number', required: false, multiple: false },
    ];

    const claim = buildClaimFromFlags({ replicas: 3 }, specs);

    expect(claim).toEqual({ replicas: 3 });
  });

  it('deeply nests multiple dotted paths correctly', () => {
    const specs: FlagSpec[] = [
      { path: 'a.b.c', type: 'string', required: false, multiple: false },
      { path: 'a.b.d', type: 'string', required: false, multiple: false },
      { path: 'a.e', type: 'string', required: false, multiple: false },
    ];

    const claim = buildClaimFromFlags(
      { 'a.b.c': 'x', 'a.b.d': 'y', 'a.e': 'z' },
      specs,
    );

    expect(claim).toEqual({
      a: {
        b: { c: 'x', d: 'y' },
        e: 'z',
      },
    });
  });

  it('parses .json escape hatch flags as JSON and sets parent path', () => {
    const specs: FlagSpec[] = [
      {
        path: 'providesApis.json',
        type: 'string',
        required: false,
        multiple: false,
      },
    ];

    const claim = buildClaimFromFlags(
      {
        'providesApis.json':
          '[{"name":"users","version":"v1"},{"name":"inventory","version":"v2"}]',
      },
      specs,
    );

    expect(claim).toEqual({
      providesApis: [
        { name: 'users', version: 'v1' },
        { name: 'inventory', version: 'v2' },
      ],
    });
  });

  it('parses .json escape hatch with object value', () => {
    const specs: FlagSpec[] = [
      {
        path: 'providesApis.json',
        type: 'string',
        required: false,
        multiple: false,
      },
    ];

    const claim = buildClaimFromFlags(
      {
        'providesApis.json':
          '{"users":{"description":"User API","version":"v1"}}',
      },
      specs,
    );

    expect(claim).toEqual({
      providesApis: {
        users: { description: 'User API', version: 'v1' },
      },
    });
  });

  it('rejects invalid JSON with the flag name', () => {
    const specs: FlagSpec[] = [
      {
        path: 'providesApis.json',
        type: 'string',
        required: false,
        multiple: false,
      },
    ];

    expect(() =>
      buildClaimFromFlags({ 'providesApis.json': 'not-json' }, specs),
    ).toThrow('Invalid JSON for --providesApis.json');
  });

  it('synthesizes required empty containers before applying flags', () => {
    expect(buildClaimFromFlags({ name: 'payments' }, [], ['providers'])).toEqual(
      {
        providers: {},
      },
    );
  });

  it('applies schema defaults only when an optional parent is supplied', () => {
    const specs: FlagSpec[] = [
      {
        path: 'chart.name',
        type: 'string',
        required: false,
        multiple: false,
      },
      {
        path: 'chart.oci',
        type: 'boolean',
        required: false,
        defaultValue: false,
        conditionalDefault: true,
        multiple: false,
      },
    ];

    expect(buildClaimFromFlags({}, specs)).toEqual({});
    expect(buildClaimFromFlags({'chart.name': 'api'}, specs)).toEqual({
      chart: {name: 'api', oci: false},
    });
  });

  it('normalizes compatibility enum casing to the canonical value', () => {
    const specs: FlagSpec[] = [
      {
        path: 'providers.terraform.source',
        type: 'string',
        required: true,
        multiple: false,
        enumValues: ['remote', 'inline', 'Remote', 'Inline'],
      },
    ];

    expect(
      buildClaimFromFlags(
        { 'providers.terraform.source': 'Remote' },
        specs,
      ),
    ).toEqual({ providers: { terraform: { source: 'remote' } } });
  });

  it('nests pages.public and pages.https_enforced under providers.github.pages', () => {
    const specs: FlagSpec[] = [
      {
        path: 'providers.github.pages.public',
        type: 'boolean',
        required: false,
        multiple: false,
      },
      {
        path: 'providers.github.pages.https_enforced',
        type: 'boolean',
        required: false,
        multiple: false,
      },
    ];

    const claim = buildClaimFromFlags(
      {
        'providers.github.pages.public': true,
        'providers.github.pages.https_enforced': true,
      },
      specs,
    );

    expect(claim).toEqual({
      providers: {
        github: {
          pages: {
            public: true,
            https_enforced: true,
          },
        },
      },
    });
  });
});
