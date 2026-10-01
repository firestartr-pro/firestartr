export default async function globalTeardown(): Promise<void> {
  const handle = (globalThis as Record<string, unknown>)
    .__diagnosticInterval as ReturnType<typeof setInterval> | undefined;

  if (handle) {
    clearInterval(handle);
  }
}
