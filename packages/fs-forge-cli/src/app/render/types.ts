export type RenderOutcome =
  | { kind: 'create' }
  | { kind: 'merge'; added: string[] }
  | { kind: 'noop' }
  | { kind: 'conflict'; reason: string };

export type RenderedFile =
  | {
      path: string;
      content: string;
      outcome:
        | { kind: 'create' }
        | { kind: 'merge'; added: string[] }
        | { kind: 'noop' };
      notes?: string[];
    }
  | {
      path: string;
      content?: never;
      outcome: { kind: 'conflict'; reason: string };
      notes?: string[];
    };
