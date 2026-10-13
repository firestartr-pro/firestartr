import common from 'catalog_common';

export class CleanupRunner {
  private readonly errors: string[] = [];

  async run(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.errors.push(
        `${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Throws the aggregate of collected errors. Without a context the errors are
  // thrown as-is, so callers can keep their own message shape.
  throwOnErrors(context?: string): void {
    if (this.errors.length === 0) return;

    const detail = this.errors.join('\n');
    throw new Error(
      context ? `Cleanup failed for ${context}:\n${detail}` : detail,
    );
  }

  warnOnErrors(logPrefix: string, phase = 'cleanup'): void {
    if (this.errors.length > 0) {
      common.logger.warn(
        `[${logPrefix}] ${phase} completed with errors:\n${this.errors.join('\n')}`,
      );
    }
  }
}
