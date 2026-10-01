import { getWorkItemIdentity } from '../src/definitions';

describe('getWorkItemIdentity', () => {
  it('returns uid if present in item.metadata', () => {
    const workItem = { item: { metadata: { uid: 'abc123' } } };
    expect(getWorkItemIdentity(workItem as any)).toBe('abc123');
  });

  it('returns uid if present in metadata at top level', () => {
    const workItem = { metadata: { uid: 'xyz789' } };
    expect(getWorkItemIdentity(workItem as any)).toBe('xyz789');
  });

  it('returns undefined if uid is missing in both locations', () => {
    const workItem = { item: { metadata: {} } };
    expect(getWorkItemIdentity(workItem as any)).toBeUndefined();
  });

  it('returns undefined if metadata does not exist', () => {
    const workItem = { item: {} };
    expect(getWorkItemIdentity(workItem as any)).toBeUndefined();
  });

  it('returns undefined if neither item nor metadata exists', () => {
    const workItem = {};
    expect(getWorkItemIdentity(workItem as any)).toBeUndefined();
  });
});
