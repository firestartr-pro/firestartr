import { Semaphore } from '../src/utils/semaphore';

describe('Semaphore', () => {
  it('throws for invalid max values', () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(Number.NaN)).toThrow();
    expect(() => new Semaphore(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('floors fractional max values above zero', async () => {
    const semaphore = new Semaphore(2.9);

    await semaphore.acquire();
    await semaphore.acquire();

    const third = semaphore.acquire();
    expect(semaphore.current).toBe(2);
    expect(semaphore.waiting).toBe(1);

    semaphore.release();
    await third;

    semaphore.release();
    semaphore.release();

    expect(semaphore.current).toBe(0);
    expect(semaphore.waiting).toBe(0);
  });

  it('allows up to max and settles back to zero', async () => {
    const semaphore = new Semaphore(2);

    await semaphore.acquire();
    await semaphore.acquire();

    expect(semaphore.current).toBe(2);
    expect(semaphore.waiting).toBe(0);

    semaphore.release();
    semaphore.release();

    expect(semaphore.current).toBe(0);
  });

  it('queues beyond max in FIFO order and preserves current during handoff', async () => {
    const semaphore = new Semaphore(1);
    const events: Array<string> = [];

    await semaphore.acquire();

    expect(semaphore.current).toBe(1);

    const first = semaphore.acquire().then(() => events.push('first'));
    const second = semaphore.acquire().then(() => events.push('second'));

    expect(semaphore.waiting).toBe(2);
    expect(semaphore.current).toBe(1);

    semaphore.release();
    expect(semaphore.current).toBe(1);
    expect(semaphore.waiting).toBe(1);

    await first;

    expect(semaphore.current).toBe(1);
    expect(events).toEqual(['first']);

    semaphore.release();
    expect(semaphore.current).toBe(1);
    expect(semaphore.waiting).toBe(0);

    await second;

    expect(events).toEqual(['first', 'second']);
    semaphore.release();
    expect(semaphore.current).toBe(0);
  });

  it('never goes negative when released too far', () => {
    const semaphore = new Semaphore(1);

    semaphore.release();

    expect(semaphore.current).toBe(0);
  });
});
