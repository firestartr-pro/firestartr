import { WorkItem, WorkStatus } from './informer';

import * as fs from 'fs';

import log from './logger';

export function loopWorkItemDebug(queue: WorkItem[]) {
  let running = false;

  setInterval(() => {
    if (running) return;

    running = true;

    writeDownQueueStatus(queue)
      .then(() => {
        running = false;
      })
      .catch((err) => {
        log.error(`PANIC cannot evaluate the queue for debug!!!: ${err}`);
      });
  }, 5 * 1000);
}

async function writeDownQueueStatus(queue: WorkItem[]) {
  let output = '';

  for (const workItem of queue) {
    const item = workItem.item;

    const blockedText = workItem.isBlocked ? '[BLOCKED]' : '';
    const slotInfo =
      workItem.slotId !== undefined ? ` (slot:${workItem.slotId})` : '';
    const upsertTimeText = formatElapsedTimeWithDate(workItem.upsertTime);

    output += `${item.kind}/${item.metadata.name} - ${workItem.workStatus} ${slotInfo} - ${workItem.operation} ${blockedText} - (upsert ${upsertTimeText})\n`;
  }

  return new Promise((ok: Function, ko: Function) => {
    fs.writeFile('/tmp/queue', output, (err: any) => {
      if (err) ko(`Writing /tmp/queue: ${err}`);
      else ok();
    });
  });
}

function formatElapsedTimeWithDate(upsertTime: number): string {
  const now = new Date();

  const diffMs = now.getTime() - upsertTime;

  if (diffMs < 0) {
    return 'Future time (Error)';
  }
  if (diffMs < 1000) {
    return 'Just now';
  }

  const MS_PER_SECOND = 1000;
  const MS_PER_MINUTE = 60 * MS_PER_SECOND;
  const MS_PER_HOUR = 60 * MS_PER_MINUTE;
  const MS_PER_DAY = 24 * MS_PER_HOUR;

  const parts: string[] = [];
  let remainingMs = diffMs;

  // 1. Calculate Days
  const days = Math.floor(remainingMs / MS_PER_DAY);
  if (days > 0) {
    parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    remainingMs %= MS_PER_DAY;
  }

  // 2. Calculate Hours
  const hours = Math.floor(remainingMs / MS_PER_HOUR);
  if (hours > 0) {
    parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    remainingMs %= MS_PER_HOUR;
  }

  // 3. Calculate Minutes
  const minutes = Math.floor(remainingMs / MS_PER_MINUTE);
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    remainingMs %= MS_PER_MINUTE;
  }

  // 4. Calculate Seconds (added logic for seconds)
  const seconds = Math.floor(remainingMs / MS_PER_SECOND);

  if (seconds > 0 && parts.length < 2) {
    parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  }

  if (parts.length === 0 && seconds > 0) {
    return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
  }

  return `${parts.slice(0, 2).join(', ')} ago`;
}
