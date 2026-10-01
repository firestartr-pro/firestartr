import { withToolImageTag } from '../src/cmd/tf_planner';

describe('withToolImageTag', () => {
  it('keeps the image unchanged when no override is provided', () => {
    expect(withToolImageTag('ghcr.io/prefapp/tool:1.2.3')).toBe(
      'ghcr.io/prefapp/tool:1.2.3',
    );
  });

  it('replaces the tag when an override is provided', () => {
    expect(withToolImageTag('ghcr.io/prefapp/tool:1.2.3', '2.0.0')).toBe(
      'ghcr.io/prefapp/tool:2.0.0',
    );
  });

  it('preserves a digest suffix while replacing the tag', () => {
    expect(
      withToolImageTag('ghcr.io/prefapp/tool:1.2.3@sha256:abc123', '2.0.0'),
    ).toBe('ghcr.io/prefapp/tool:2.0.0@sha256:abc123');
  });

  it('adds a tag when the image was previously untagged', () => {
    expect(withToolImageTag('ghcr.io/prefapp/tool', '2.0.0')).toBe(
      'ghcr.io/prefapp/tool:2.0.0',
    );
  });
});
