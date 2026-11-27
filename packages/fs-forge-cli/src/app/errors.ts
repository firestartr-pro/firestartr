/** Stable codes for the ways an `app` command cannot continue. */
export type AppErrorCode = 'NO_SERVICE_CLAIM';

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
