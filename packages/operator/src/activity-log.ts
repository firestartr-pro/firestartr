import * as fs from 'fs';

const MAX_SIZE = 2 * 1024 * 1024; // 2 MiB

let logPath: string | undefined;

export function initActivityLog(): void {
  logPath = process.env.ACTIVITY_LOG;
}

function append(line: string): void {
  if (!logPath) return;

  try {
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      if (stat.size >= MAX_SIZE) {
        rotate(logPath);
      }
    }

    fs.appendFileSync(logPath, line + '\n');
  } catch {
    // best-effort — never crash the operator for logging
  }
}

function rotate(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const half = Math.floor(content.length / 2);
    const nl = content.indexOf('\n', half);
    const keep = nl === -1 ? '' : content.slice(nl + 1);
    fs.writeFileSync(filePath, keep, 'utf8');
  } catch {
    // if rotation fails, truncate to make room
    try {
      fs.writeFileSync(filePath, '', 'utf8');
    } catch {
      // give up
    }
  }
}

export function logActivity(
  event: string,
  kind: string,
  name: string,
  namespace: string,
  resourceVersion?: string,
): void {
  const ts = new Date().toISOString();
  const rv = resourceVersion ? ` rv=${resourceVersion}` : '';
  append(`${ts}  ${event.padEnd(8)}  ${kind}  ${name}  ns=${namespace}${rv}`);
}
