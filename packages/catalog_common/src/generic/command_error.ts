export function buildCommandExecutionError(
  output: string,
  exitCode: number,
  command: Array<string>,
  opts: {
    errorName?: string;
    label?: string;
  } = {},
) {
  const label = opts.label ?? 'Command';
  const errorName = opts.errorName ?? 'CommandExecutionError';
  const message =
    output ||
    `${label} '${command.join(' ')}' failed with exit code ${exitCode}`;

  return Object.assign(new Error(message), {
    name: errorName,
    output,
    exitCode,
    command,
  });
}

export function normalizeExitCode(code: number | null) {
  return typeof code === 'number' ? code : -1;
}
