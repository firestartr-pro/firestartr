import { ChildProcess } from 'child_process';

import log from './logger';

export type ProcessHandler = {
  processKilled(killed: boolean): void;
  hardTimeout: number;
  tfCacheDir?: string;
};

const GRACE_PERIOD = 60 * 2; // 2 min
const HARD_RESET_PERIOD = 10; // 10 sec

export function processHandler(
  processToHandle: ChildProcess,
  ctl: ProcessHandler,
  onTimedOut: Function,
) {
  let gracefulResetId;
  let hardResetId;
  let callerNotified = false;
  let timedOut = false;

  const safeKill = (signal: NodeJS.Signals | number) => {
    try {
      const sent = processToHandle.kill(signal);
      if (!sent) {
        throw new Error(`Failed to send signal ${signal} to the process`);
      }
    } catch (error) {
      log.error(
        `FATAL: timeout signal ${signal} could not be delivered to the process: ${error}`,
      );

      if (!callerNotified) {
        ctl.processKilled(false);
        callerNotified = true;
      }
    }
  };

  const terminateId = setTimeout(() => {
    // we take control of the process
    onTimedOut();
    timedOut = true;

    // send sigInt
    log.error(
      `Terraform process has not exited after initial timeout of ${ctl.hardTimeout} seconds, sending SIGINT...`,
    );
    safeKill('SIGINT');

    // grace period
    gracefulResetId = setTimeout(() => {
      log.error(
        `Terraform process has not exited after SIGINT grace period of ${GRACE_PERIOD} seconds (total elapsed ~${ctl.hardTimeout + GRACE_PERIOD} seconds), sending SIGTERM...`,
      );
      safeKill('SIGTERM');

      // hard reset period
      hardResetId = setTimeout(() => {
        log.error(
          `Terraform process has not exited after SIGTERM hard reset period of ${HARD_RESET_PERIOD} seconds (total elapsed ~${ctl.hardTimeout + GRACE_PERIOD + HARD_RESET_PERIOD} seconds), sending SIGKILL...`,
        );
        safeKill('SIGKILL');

        setTimeout(() => {
          // we send if the process was killed or not to the caller
          if (!callerNotified) {
            ctl.processKilled(processToHandle.killed);
            callerNotified = true;
          }
        }, 10 * 1000);
      }, HARD_RESET_PERIOD * 1000);
    }, GRACE_PERIOD * 1000);
  }, ctl.hardTimeout * 1000);

  processToHandle.on('exit', () => {
    // the process has exited
    // let's clear all the timeouts
    if (terminateId) {
      clearTimeout(terminateId);
    }

    if (gracefulResetId) {
      clearTimeout(gracefulResetId);
    }

    if (hardResetId) {
      clearTimeout(hardResetId);
    }

    // we inform the caller
    // if the process exited and the timeout control has kicked-off
    if (!callerNotified && timedOut) {
      ctl.processKilled(true);
      callerNotified = true;
    }
  });
}
