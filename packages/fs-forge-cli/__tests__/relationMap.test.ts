import { describe, expect, it } from '@jest/globals';

import {
  buildRelationGraph,
  renderRelationGraph,
} from '../src/lib/relationMap';

const component = {
  kind: 'ComponentClaim',
  name: 'api',
  owner: 'group:platform',
};

describe('claim relation map', () => {
  it.each([
    ['owner', 'group:platform'],
    ['maintainedBy', ['group:platform']],
    ['platformOwner', 'group:platform'],
    ['subComponentOf', 'component:platform'],
    ['system', 'system:payments'],
    ['domain', 'domain:commerce'],
    ['parent', 'group:platform'],
  ])('nests a claim through %s', (field, reference) => {
    const graph = buildRelationGraph([
      { kind: 'ComponentClaim', name: 'api', [field]: reference },
    ]);

    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: expect.stringMatching(/^(Group|Component|System|Domain)Claim:/),
        to: 'ComponentClaim:api',
        relation: field,
      }),
    ]);
  });

  it.each(['children', 'members'])('nests %s below the claim', (field) => {
    const graph = buildRelationGraph([
      { kind: 'GroupClaim', name: 'platform', [field]: ['user:alice'] },
    ]);

    expect(graph.edges).toEqual([
      {
        from: 'GroupClaim:platform',
        to: 'UserClaim:alice',
        relation: field,
      },
    ]);
  });

  it('renders dangling references, cycles, and shared children', () => {
    const graph = buildRelationGraph([
      { kind: 'GroupClaim', name: 'a', parent: 'group:b' },
      {
        kind: 'GroupClaim',
        name: 'b',
        parent: 'group:a',
        children: ['component:shared', 'group:missing'],
      },
      { kind: 'SystemClaim', name: 'system', children: ['component:shared'] },
      { kind: 'ComponentClaim', name: 'shared' },
    ]);
    const output = renderRelationGraph(graph, { ascii: true }).join('\n');

    expect(output).toContain('[cycle]');
    expect(output).toMatch(/GroupClaim: missing .*\[dangling\]/);
    expect(output.match(/ComponentClaim: shared/g)).toHaveLength(2);
  });

  it('resolves only references in the current namespace', () => {
    const graph = buildRelationGraph(
      [
        { kind: 'GroupClaim', name: 'platform' },
        {
          kind: 'ComponentClaim',
          name: 'api',
          owner: 'group:example/platform',
          maintainedBy: ['group:other/platform'],
        },
      ],
      'example',
    );

    expect(graph.nodes).toContainEqual({
      id: 'GroupClaim:platform',
      kind: 'GroupClaim',
      name: 'platform',
    });
    expect(graph.nodes).toContainEqual({
      id: 'GroupClaim:other/platform',
      kind: 'GroupClaim',
      name: 'other/platform',
      dangling: true,
    });
  });

  it('handles empty and single-node maps', () => {
    expect(renderRelationGraph(buildRelationGraph([]))).toEqual([]);
    expect(
      renderRelationGraph(
        buildRelationGraph([{ kind: 'UserClaim', name: 'alice' }]),
        { ascii: true },
      ),
    ).toEqual(['[USR] UserClaim: alice']);
  });

  it('renders emoji or ascii icons and filters multiple kinds', () => {
    const graph = buildRelationGraph([
      { kind: 'GroupClaim', name: 'platform', children: ['user:alice'] },
      { kind: 'UserClaim', name: 'alice' },
      component,
    ]);

    expect(renderRelationGraph(graph)[0]).toMatch(/^👥/u);
    expect(
      renderRelationGraph(graph, {
        ascii: true,
        kinds: ['GroupClaim', 'UserClaim'],
      }).join('\n'),
    ).toBe(
      '[GRP] GroupClaim: platform\n└─ [USR] UserClaim: alice (children)',
    );
  });

  it('marks added, removed, and changed relations from an explicit status graph', () => {
    // `diagram print` accepts arbitrary RelationGraph JSON that may already
    // carry `status`/`dangling` (ADR 0006) — this is the shape it renders,
    // independent of the (now removed) claims-specific diff builder.
    const graph = {
      nodes: [
        { id: 'ComponentClaim:api', kind: 'ComponentClaim', name: 'api', status: 'changed' as const },
        {
          id: 'GroupClaim:platform',
          kind: 'GroupClaim',
          name: 'platform',
          status: 'removed' as const,
        },
        {
          id: 'GroupClaim:applications',
          kind: 'GroupClaim',
          name: 'applications',
          status: 'added' as const,
        },
      ],
      edges: [
        {
          from: 'ComponentClaim:api',
          to: 'GroupClaim:platform',
          relation: 'owner',
          status: 'removed' as const,
        },
        {
          from: 'ComponentClaim:api',
          to: 'GroupClaim:applications',
          relation: 'owner',
          status: 'added' as const,
        },
        {
          from: 'ComponentClaim:api',
          to: 'GroupClaim:platform',
          relation: 'maintainedBy',
          status: 'added' as const,
        },
      ],
    };
    const output = renderRelationGraph(graph, { ascii: true }).join('\n');

    expect(output).toContain('- [GRP] GroupClaim: platform (owner)');
    expect(output).toContain('+ [GRP] GroupClaim: applications (owner)');
    expect(output).toContain('+ [GRP] GroupClaim: platform (maintainedBy)');
    expect(output).toContain('~ [CMP] ComponentClaim: api');
  });
});
