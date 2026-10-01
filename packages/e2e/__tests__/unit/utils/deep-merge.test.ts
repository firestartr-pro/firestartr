import { deepMerge } from '../../../src/utils/deep-merge';

describe('deepMerge', () => {
  it('merges nested objects recursively', () => {
    const target = {
      spec: {
        context: {
          backend: {
            ref: 'backend-a',
          },
        },
      },
      metadata: {
        name: 'resource-a',
      },
    };
    const source = {
      spec: {
        context: {
          provider: {
            ref: 'provider-a',
          },
        },
      },
    };

    const merged = deepMerge(target, source);

    expect(merged).toEqual({
      spec: {
        context: {
          backend: {
            ref: 'backend-a',
          },
          provider: {
            ref: 'provider-a',
          },
        },
      },
      metadata: {
        name: 'resource-a',
      },
    });
    expect(target).toEqual({
      spec: {
        context: {
          backend: {
            ref: 'backend-a',
          },
        },
      },
      metadata: {
        name: 'resource-a',
      },
    });
  });

  it('overwrites primitive values', () => {
    const merged = deepMerge(
      {
        retries: 1,
      },
      {
        retries: 3,
      },
    );

    expect(merged).toEqual({ retries: 3 });
  });

  it('overwrites arrays without merging elements', () => {
    const merged = deepMerge(
      {
        members: ['a', 'b'],
      },
      {
        members: ['c'],
      },
    );

    expect(merged).toEqual({ members: ['c'] });
  });

  it('throws when target is not a plain object', () => {
    expect(() =>
      deepMerge(null as unknown as Record<string, unknown>, {}),
    ).toThrow('deepMerge target must be a plain object');
  });

  it('throws when source is not a plain object', () => {
    expect(() =>
      deepMerge(
        {} as Record<string, unknown>,
        [] as unknown as Record<string, unknown>,
      ),
    ).toThrow('deepMerge source must be a plain object');
  });
});
