import type { ObservableGauge, ObservableResult } from '@opentelemetry/api';
import { Meter } from '@opentelemetry/api';

// this is a singleton
// to track global metrics across all slots, such as average processing time per item,
// fastest and slowest processing times, etc.
export class ProcessorGlobalMetrics {
  private static _instance: ProcessorGlobalMetrics | null = null;

  private _processedItems = 0;
  private _totalRunningSeconds = 0;
  private _minTime = Infinity;
  private _maxTime = 0;

  private constructor(meter: Meter) {
    // Global average processing time (no slot_id label)
    meter
      .createObservableGauge('firestartr.avg_processing_time_seconds', {
        description: 'Average processing time per item across ALL slots',
        unit: 's',
      })
      .addCallback((observableResult: ObservableResult) => {
        const avg =
          this._processedItems > 0
            ? this._totalRunningSeconds / this._processedItems
            : 0;
        observableResult.observe(avg);
      });

    // Global fastest
    meter
      .createObservableGauge('firestartr.fastest_processing_time_seconds', {
        description: 'Fastest single item processing time across ALL slots',
        unit: 's',
      })
      .addCallback((observableResult: ObservableResult) => {
        observableResult.observe(this._processedItems > 0 ? this._minTime : 0);
      });

    // Global slowest
    meter
      .createObservableGauge('firestartr.slowest_processing_time_seconds', {
        description: 'Slowest single item processing time across ALL slots',
        unit: 's',
      })
      .addCallback((observableResult: ObservableResult) => {
        observableResult.observe(this._processedItems > 0 ? this._maxTime : 0);
      });
  }

  public static init(meter: Meter): void {
    if (!ProcessorGlobalMetrics._instance) {
      ProcessorGlobalMetrics._instance = new ProcessorGlobalMetrics(meter);
    }
  }

  public static getInstance(): ProcessorGlobalMetrics {
    if (!ProcessorGlobalMetrics._instance) {
      throw new Error(
        'ProcessorGlobalMetrics must be initialized with .init(meter) first',
      );
    }
    return ProcessorGlobalMetrics._instance;
  }

  public recordProcessingDuration(durationSeconds: number): void {
    if (durationSeconds <= 0) return;
    this._processedItems++;
    this._totalRunningSeconds += durationSeconds;
    this._minTime = Math.min(this._minTime, durationSeconds);
    this._maxTime = Math.max(this._maxTime, durationSeconds);
  }
}
