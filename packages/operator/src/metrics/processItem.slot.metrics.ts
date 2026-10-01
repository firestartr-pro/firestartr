import { Meter } from '@opentelemetry/api';

import type {
  Counter,
  ObservableGauge,
  ObservableResult,
} from '@opentelemetry/api';

export class ProcessItemSlotMetrics {
  private _workItemsTotal: Counter;
  private _runningTimeSecondsTotal: Counter;
  private _idleTimeSecondsTotal: ObservableGauge;
  private _uptimeSeconds: ObservableGauge;

  private _startTime: number;
  private _lastStateChangeTime: number;
  private _runningSeconds = 0;
  private _running = false;
  private _id: number;

  constructor(id: number, meter: Meter) {
    this._id = id;
    this._startTime = Date.now();
    this._lastStateChangeTime = Date.now();
    this._runningSeconds = 0;

    const commonAttributes = { slot_id: String(id) };

    // Counters (use .add())
    this._workItemsTotal = meter.createCounter(
      'firestartr_slot.work_items_total',
      {
        description: 'Total number of work items processed by this slot',
        unit: '1',
      },
    );

    this._runningTimeSecondsTotal = meter.createCounter(
      'firestartr_slot.running_time_seconds_total',
      {
        description: 'Total time this slot has spent running work items',
        unit: 's',
      },
    );

    // Observable Gauges (use .addCallback() + .observe())
    this._uptimeSeconds = meter.createObservableGauge(
      'firestartr_slot.uptime_seconds',
      {
        description:
          'Total runtime of this slot since creation (running + idle)',
        unit: 's',
      },
    );
    this._uptimeSeconds.addCallback((observableResult: ObservableResult) => {
      const uptime = (Date.now() - this._startTime) / 1000;
      observableResult.observe(uptime, commonAttributes);
    });

    this._idleTimeSecondsTotal = meter.createObservableGauge(
      'firestartr_slot.idle_time_seconds_total',
      {
        description:
          'Total time this slot has spent NOT processing items (idle)',
        unit: 's',
      },
    );
    this._idleTimeSecondsTotal.addCallback(
      (observableResult: ObservableResult) => {
        const uptime = (Date.now() - this._startTime) / 1000;
        const inProgressRunning = this._running
          ? (Date.now() - this._lastStateChangeTime) / 1000
          : 0;
        const idleTime = Math.max(
          0,
          uptime - this._runningSeconds - inProgressRunning,
        );
        observableResult.observe(idleTime, commonAttributes);
      },
    );
  }

  runItemStarted() {
    this._lastStateChangeTime = Date.now();
    this._running = true;
  }

  runItemFinished() {
    const now = Date.now();
    const runningDuration = (now - this._lastStateChangeTime) / 1000;

    this._runningSeconds += runningDuration;
    this._runningTimeSecondsTotal.add(runningDuration, {
      slot_id: String(this._id),
    });
    this._workItemsTotal.add(1, { slot_id: String(this._id) });

    this._lastStateChangeTime = now;
    this._running = false;
  }
}
