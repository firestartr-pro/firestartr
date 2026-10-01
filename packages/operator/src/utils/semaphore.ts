export class Semaphore {
  private readonly _max: number;

  private _current = 0;

  private readonly _queue: Array<() => void> = [];

  private _totalAcquisitions = 0;

  private _timesSaturated = 0;

  constructor(max: number) {
    if (!Number.isFinite(max) || Number.isNaN(max) || max < 1) {
      throw new Error(`Semaphore max must be a finite number >= 1: ${max}`);
    }

    this._max = Math.floor(max);
  }

  get max(): number {
    return this._max;
  }

  get current(): number {
    return this._current;
  }

  get waiting(): number {
    return this._queue.length;
  }

  get totalAcquisitions(): number {
    return this._totalAcquisitions;
  }

  get timesSaturated(): number {
    return this._timesSaturated;
  }

  async acquire(): Promise<void> {
    if (this._current < this._max) {
      this._current++;
      this._totalAcquisitions++;
      return;
    }

    this._timesSaturated++;

    await new Promise<void>((resolve) => {
      this._queue.push(() => {
        this._current++;
        this._totalAcquisitions++;
        resolve();
      });
    });
  }

  release(): void {
    if (this._current <= 0) {
      this._current = 0;
      return;
    }

    this._current--;

    const next = this._queue.shift();
    if (next) {
      next();
    }
  }
}
