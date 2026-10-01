export type NameBuilder = {
  prefix: string;
  build: (suffix?: string) => string;
};

export function resolveNamePrefix(input?: string): string {
  return input ?? process.env.E2E_NAME_PREFIX ?? '';
}

export function normalizeNamePrefix(input?: string): string {
  return resolveNamePrefix(input).trim();
}

export function buildE2ePrefix(input?: string): string {
  const normalizedPrefix = normalizeNamePrefix(input);
  return normalizedPrefix ? `${normalizedPrefix}-e2e` : 'e2e';
}

export function createNameBuilder(namePrefix: string): NameBuilder {
  const prefix = buildE2ePrefix(namePrefix);

  return {
    prefix,
    build(suffixOverride?: string): string {
      const suffix = suffixOverride?.trim();

      if (!suffix) {
        return prefix;
      }

      return `${prefix}-${suffix}`;
    },
  };
}
