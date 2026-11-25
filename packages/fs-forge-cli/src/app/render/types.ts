export type RenderOutcome =
  | { kind: 'create' }
  | { kind: 'merge'; added: string[] }
  | { kind: 'noop' }
  | { kind: 'conflict'; reason: string };

export interface RenderedFile {
  path: string;
  content: string;
  outcome: RenderOutcome;
}
