process.env.CRS_STATUS_KIND_LIST = 'fsdummiesa,fsdummiesb,fsdummiesc';
process.env.CRS_STATUS_NAMESPACE = 'default';

import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { runService } from './index';

const PID_FILE = '/tmp/crs-status-dev.pid';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function handleExistingPid() {
  if (!existsSync(PID_FILE)) return;

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8'), 10);
  if (isNaN(pid) || !isProcessRunning(pid)) {
    removePidFile();
    return;
  }

  console.log(`Found existing crs-status (PID: ${pid}). Sending SIGUSR1...`);
  try {
    process.kill(pid, 'SIGUSR1');
  } catch {
    /* ok */
  }

  for (let i = 0; i < 120; i++) {
    if (!isProcessRunning(pid)) {
      console.log(`Process ${pid} exited.`);
      removePidFile();
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`Process ${pid} still running after 120s. Sending SIGKILL...`);
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* ok */
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
  process.on('SIGUSR1', handler);
  process.on('exit', removePidFile);
}

async function main() {
  await handleExistingPid();
  writePidFile();
  registerShutdownHandlers();
  await runService();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
