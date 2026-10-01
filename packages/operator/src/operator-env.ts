const ENV_KEYS = [
  'ORG',
  'GITHUB_APP_ID',
  'GITHUB_APP_PEM_FILE',
  'PREFAPP_BOT_PAT',
] as const;

type OperatorEnvKey = (typeof ENV_KEYS)[number];
export type OperatorEnvSnapshot = Partial<Record<OperatorEnvKey, string>>;

let snapshot: OperatorEnvSnapshot | undefined;

function captureSnapshot(): OperatorEnvSnapshot {
  const result: OperatorEnvSnapshot = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

export function getOperatorEnvSnapshot(): OperatorEnvSnapshot {
  if (!snapshot) {
    snapshot = captureSnapshot();
  }
  return { ...snapshot };
}
