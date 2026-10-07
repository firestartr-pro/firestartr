import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import dotenv from 'dotenv';

(global as any).__filename = fileURLToPath(import.meta.url);
(global as any).__dirname = dirname((global as any).__filename);

dotenv.config({ path: '/library/.env', override: true });

import { runOperator } from '.';

const PID_FILE = '/tmp/run-local-dev.pid';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

async function handleExistingPid() {
  if (!existsSync(PID_FILE)) return;

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8'), 10);
  if (isNaN(pid) || !isProcessRunning(pid)) {
    removePidFile();
    return;
  }

  console.log(`Found existing operator (PID: ${pid}). Sending SIGUSR1...`);
  try {
    process.kill(pid, 'SIGUSR1'); // Signal 10
  } catch (e) {
    console.error(`Failed to send SIGUSR1 to ${pid}:`, e);
  }

  // Wait up to 120s
  for (let i = 0; i < 120; i++) {
    if (!isProcessRunning(pid)) {
      console.log(`Process ${pid} exited.`);
      removePidFile();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`Process ${pid} still running after 120s. Sending SIGKILL...`);
  try {
    process.kill(pid, 'SIGKILL');
  } catch (e) {
    console.error(`Failed to send SIGKILL to ${pid}:`, e);
  }
  removePidFile();
}

function writePidFile() {
  writeFileSync(PID_FILE, process.pid.toString(), 'utf-8');
}

function removePidFile() {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    /* ok */
  }
}

function registerShutdownHandlers() {
  const handler = () => {
    removePidFile();
    process.exit(0);
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
  process.on('SIGUSR1', handler); // Also handle SIGUSR1 for clean shutdown
  process.on('exit', removePidFile);
}

async function main() {
  await handleExistingPid();
  writePidFile();
  registerShutdownHandlers();

  const namespace = process.env.OPERATOR_NAMESPACE || 'default';
  const kindList = (
    process.env.OPERATOR_KIND_LIST ||
    'fsdummiesa,fsdummiesb,fsdummiesc,terraformworkspaces'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  runOperator({
    ignoreLease: true,
    dummyExec: false,
    withMetrics: true,
    namespace,
    kindList,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
