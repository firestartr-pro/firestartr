export async function withEnv<T = unknown>(
  newEnv: NodeJS.ProcessEnv,
  fn: any,
  options: { replace?: boolean } = {},
): Promise<T> {
  // Save current env
  const originalEnv = { ...process.env };

  try {
    if (options.replace) {
      // Full replacement (clean env)
      Object.keys(process.env).forEach((key) => delete process.env[key]);
      Object.assign(process.env, newEnv);
    } else {
      // only merge the specific vars
      Object.assign(process.env, newEnv);
    }

    // Run your code
    const result = fn();
    return result instanceof Promise ? await result : result;
  } finally {
    // ALWAYS restore original env
    Object.keys(process.env).forEach((key) => delete process.env[key]);
    Object.assign(process.env, originalEnv);
  }
}
