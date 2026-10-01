import { CLAIM_KINDS } from '../claims/kinds.js';

export type RelationStatus = 'added' | 'removed' | 'changed';

export interface RelationNode {
  id: string;
  kind: string;
  name: string;
  dangling?: boolean;
  status?: RelationStatus;
}

export interface RelationEdge {
  from: string;
  to: string;
  relation: string;
  status?: RelationStatus;
}

export interface RelationGraph {
  nodes: RelationNode[];
  edges: RelationEdge[];
}

export interface RelationRenderOptions {
  ascii?: boolean;
  kinds?: string[];
}

type Claim = Record<string, unknown>;

const PARENT_RELATIONS = [
  'owner',
  'maintainedBy',
  'platformOwner',
  'subComponentOf',
  'system',
  'domain',
  'parent',
] as const;
const CHILD_RELATIONS = ['children', 'members'] as const;
const KIND_LOOKUP = new Map(
  Object.keys(CLAIM_KINDS).flatMap((kind) => [
    [kind.toLowerCase(), kind],
    [kind.replace(/Claim$/, '').toLowerCase(), kind],
  ]),
);

function claimIdentity(claim: Claim): RelationNode | null {
  if (typeof claim.kind !== 'string' || typeof claim.name !== 'string') {
    return null;
  }
  return {
    id: `${claim.kind}:${claim.name}`,
    kind: claim.kind,
    name: claim.name,
  };
}

function referenceNode(reference: string, namespace?: string): RelationNode {
  const separator = reference.indexOf(':');
  const prefix = separator < 0 ? 'unknown' : reference.slice(0, separator);
  const rawName = separator < 0 ? reference : reference.slice(separator + 1);
  const [referenceNamespace, namespacedName] = rawName.split('/');
  const targetName =
    namespace && namespacedName && referenceNamespace === namespace
      ? namespacedName
      : rawName;
  const kind = KIND_LOOKUP.get(prefix.toLowerCase()) ?? prefix;
  return { id: `${kind}:${targetName}`, kind, name: rawName, dangling: true };
}

function references(claim: Claim, field: string): string[] {
  const value = claim[field];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function relationEntries(
  claim: Claim,
  namespace?: string,
): Array<{ node: RelationNode; relation: string; parent: boolean }> {
  return [
    ...PARENT_RELATIONS.flatMap((relation) =>
      references(claim, relation).map((reference) => ({
        node: referenceNode(reference, namespace),
        relation,
        parent: true,
      })),
    ),
    ...CHILD_RELATIONS.flatMap((relation) =>
      references(claim, relation).map((reference) => ({
        node: referenceNode(reference, namespace),
        relation,
        parent: false,
      })),
    ),
  ];
}

function sortedGraph(
  nodes: Map<string, RelationNode>,
  edges: Map<string, RelationEdge>,
): RelationGraph {
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) =>
      `${a.from}:${a.to}:${a.relation}`.localeCompare(
        `${b.from}:${b.to}:${b.relation}`,
      ),
    ),
  };
}

export function buildRelationGraph(
  claims: Claim[],
  namespace?: string,
): RelationGraph {
  const nodes = new Map<string, RelationNode>();
  const edges = new Map<string, RelationEdge>();

  for (const claim of claims) {
    const source = claimIdentity(claim);
    if (source) nodes.set(source.id, source);
  }
  for (const claim of claims) {
    const source = claimIdentity(claim);
    if (!source) continue;
    for (const entry of relationEntries(claim, namespace)) {
      if (!nodes.has(entry.node.id)) nodes.set(entry.node.id, entry.node);
      const edge = entry.parent
        ? { from: entry.node.id, to: source.id, relation: entry.relation }
        : { from: source.id, to: entry.node.id, relation: entry.relation };
      const key = `${edge.from}\0${edge.to}\0${edge.relation}`;
      if (!edges.has(key)) edges.set(key, edge);
    }
  }
  return sortedGraph(nodes, edges);
}

function icon(node: RelationNode, ascii: boolean): string {
  const entry = CLAIM_KINDS[node.kind as keyof typeof CLAIM_KINDS];
  if (entry) return ascii ? entry.ascii : entry.emoji;
  return ascii ? '[???]' : '❓';
}

function marker(status: RelationStatus | undefined): string {
  if (status === 'added') return '+ ';
  if (status === 'removed') return '- ';
  if (status === 'changed') return '~ ';
  return '';
}

export function filterRelationGraph(
  graph: RelationGraph,
  kinds: string[] | undefined,
): RelationGraph {
  if (!kinds?.length) return graph;
  const allowed = new Set(kinds);
  const nodes = graph.nodes.filter((node) => allowed.has(node.kind));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}

export function renderRelationGraph(
  graph: RelationGraph,
  options: RelationRenderOptions = {},
): string[] {
  const filtered = filterRelationGraph(graph, options.kinds);
  const nodes = new Map(filtered.nodes.map((node) => [node.id, node]));
  const edges = filtered.edges.filter(
    (edge) => nodes.has(edge.from) && nodes.has(edge.to),
  );
  const children = new Map<string, RelationEdge[]>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge]);
    incoming.add(edge.to);
  }
  for (const entries of children.values()) {
    entries.sort((a, b) =>
      `${a.to}:${a.relation}`.localeCompare(`${b.to}:${b.relation}`),
    );
  }

  const lines: string[] = [];
  const covered = new Set<string>();
  const render = (
    id: string,
    prefix: string,
    connector: string,
    relation?: string,
    edgeStatus?: RelationStatus,
    path = new Set<string>(),
  ): void => {
    const node = nodes.get(id);
    if (!node) return;
    covered.add(id);
    const cycle = path.has(id);
    lines.push(
      `${prefix}${connector}${marker(edgeStatus ?? node.status)}${icon(node, options.ascii ?? false)} ${node.kind}: ${node.name}${relation ? ` (${relation})` : ''}${node.dangling ? ' [dangling]' : ''}${cycle ? ' [cycle]' : ''}`,
    );
    if (cycle) return;
    const nextPath = new Set(path).add(id);
    const nodeChildren = children.get(id) ?? [];
    nodeChildren.forEach((edge, index) => {
      const last = index === nodeChildren.length - 1;
      render(
        edge.to,
        `${prefix}${connector ? (connector === '└─ ' ? '   ' : '│  ') : ''}`,
        last ? '└─ ' : '├─ ',
        edge.relation,
        edge.status,
        nextPath,
      );
    });
  };

  const roots = [...nodes.keys()].filter((id) => !incoming.has(id)).sort();
  for (const root of roots) render(root, '', '');
  for (const id of [...nodes.keys()].sort()) {
    if (!covered.has(id)) render(id, '', '');
  }
  return lines;
}
