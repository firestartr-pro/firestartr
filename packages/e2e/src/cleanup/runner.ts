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

  throwOnErrors(context: string): void {
    if (this.errors.length > 0) {
      throw new Error(
        `Cleanup failed for ${context}:\n${this.errors.join('\n')}`,
      );
    }
  }

  warnOnErrors(logPrefix: string, phase = 'cleanup'): void {
    if (this.errors.length > 0) {
      common.logger.warn(
        `[${logPrefix}] ${phase} completed with errors:\n${this.errors.join('\n')}`,
      );
    }
  }
}
