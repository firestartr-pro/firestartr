import {
  buildE2ePrefix,
  createNameBuilder,
  normalizeNamePrefix,
  resolveNamePrefix,
} from '../..';

describe('names', () => {
  const originalNamePrefix = process.env.E2E_NAME_PREFIX;

  afterEach(() => {
    if (originalNamePrefix === undefined) {
      delete process.env.E2E_NAME_PREFIX;
      return;
    }

    process.env.E2E_NAME_PREFIX = originalNamePrefix;
  });

  it('resolves explicit prefix input before env fallback', () => {
    process.env.E2E_NAME_PREFIX = 'from-env';

    expect(resolveNamePrefix('from-input')).toBe('from-input');
  });

  it('normalizes prefix input by trimming whitespace', () => {
    process.env.E2E_NAME_PREFIX = '  from-env  ';

    expect(normalizeNamePrefix('  from-input  ')).toBe('from-input');
    expect(normalizeNamePrefix(undefined)).toBe('from-env');
  });

  it('builds the e2e prefix from normalized input', () => {
    expect(buildE2ePrefix('  demo  ')).toBe('demo-e2e');
    expect(buildE2ePrefix('   ')).toBe('e2e');
  });

  it('builds deterministic names with normalized prefixes and suffixes', () => {
    const prefixedBuilder = createNameBuilder('  demo  ');

    expect(prefixedBuilder.prefix).toBe('demo-e2e');
    expect(prefixedBuilder.build()).toBe('demo-e2e');
    expect(prefixedBuilder.build('  component-a  ')).toBe(
      'demo-e2e-component-a',
    );

    const defaultBuilder = createNameBuilder('   ');
    expect(defaultBuilder.prefix).toBe('e2e');
    expect(defaultBuilder.build('  group-a ')).toBe('e2e-group-a');
  });
});
