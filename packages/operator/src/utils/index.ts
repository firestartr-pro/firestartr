const secretRegex = /\$\{\{ secrets\.(.*?) \}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getFirstNonEmptyString(...values: Array<unknown>): string | undefined {
  return values.find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
}

export function replaceConfigSecrets(config: any, secrets: any) {
  for (const key in config) {
    if (typeof config[key] === 'object' && config[key] !== null) {
      // If the property is an object, call this function recursively
      replaceConfigSecrets(config[key], secrets);
    } else if (typeof config[key] === 'string') {
      // If the property is a string and its value is equal to secrets.something,
      // replace the value with the value of the 'something' key in the secrets object
      config[key] = config[key].replace(
        secretRegex,
        (_: any, group1: string) => {
          if (!secrets[group1]) {
            throw new Error(`Secret ${group1} not found in secrets`);
          }

          return secrets[group1];
        },
      );
    }
  }

  return config;
}

export function replaceInlineSecrets(inline: string, secrets: any) {
  if (typeof inline !== 'string' || !inline) return inline;

  let result = inline;

  result = result.replace(secretRegex, (_: any, group1: string) => {
    if (!secrets[group1]) {
      throw new Error(`Secret ${group1} not found in secrets`);
    }
    return secrets[group1];
  });

  return result;
}

export function extractErrorDetails(error: unknown): {
  output: string;
  exitCode?: number;
} {
  const exitCode =
    isRecord(error) && typeof error.exitCode === 'number'
      ? error.exitCode
      : undefined;

  if (typeof error === 'string') {
    return { output: error, exitCode };
  }

  if (error instanceof Error) {
    const errorWithOutput = error as Error & { output?: unknown };
    const output = getFirstNonEmptyString(
      errorWithOutput.output,
      error.message,
    );

    return { output: output ?? String(error), exitCode };
  }

  if (isRecord(error)) {
    const output = getFirstNonEmptyString(
      error.output,
      error.message,
      error.error,
    );
    if (output !== undefined) {
      return { output, exitCode };
    }

    try {
      return { output: JSON.stringify(error), exitCode };
    } catch {
      return { output: String(error), exitCode };
    }
  }

  return { output: String(error), exitCode };
}
