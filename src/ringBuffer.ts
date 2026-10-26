/** A frozen view of the buffer, taken when the UI flushes. */
export interface RingSnapshot {
  /** Total items ever written when the snapshot was taken. */
  readonly written: number;
  /** Items visible in this snapshot (at most capacity). */
  readonly size: number;
  /** Changes on clear(), so stale snapshots can't read new data. */
  readonly epoch: number;
}

/**
 * Fixed-capacity ring buffer.
 *
 * - push() is O(1) and never allocates after construction.
 * - When full, the oldest item is overwritten, so memory stays bounded
 *   no matter how many events arrive.
 * - at(i) / atSnapshot(snap, i) read by position (0 = newest) in O(1),
 *   which is what a virtualized list needs: it only asks for visible rows.
 */
export class RingBuffer<T> {
  readonly capacity: number;
  private readonly buf: Array<T | undefined>;
  private written = 0;
  private epoch = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.capacity = capacity;
    this.buf = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return Math.min(this.written, this.capacity);
  }

  push(item: T): void {
    this.buf[this.written % this.capacity] = item;
    this.written++;
  }

  /** Live read: item at position i, where 0 is the newest. */
  at(i: number): T | undefined {
    return this.atSnapshot(this.snapshot(), i);
  }

  snapshot(): RingSnapshot {
    return { written: this.written, size: this.size, epoch: this.epoch };
  }

  /**
   * Read item i (0 = newest) as it was when `snap` was taken.
   * Returns undefined if i is out of range, if the slot has since been
   * overwritten by newer writes, or if the buffer was cleared after `snap`.
   * It never returns a different item from the one the snapshot saw.
   */
  atSnapshot(snap: RingSnapshot, i: number): T | undefined {
    if (snap.epoch !== this.epoch) return undefined;
    if (!Number.isInteger(i) || i < 0 || i >= snap.size) return undefined;
    const absolute = snap.written - 1 - i;
    if (absolute < this.written - this.capacity) return undefined; // overwritten since snapshot
    return this.buf[absolute % this.capacity];
  }

  /** Copy of the contents, newest first. O(n): for exports, not per render. */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.size; i++) out.push(this.at(i) as T);
    return out;
  }

  clear(): void {
    this.buf.fill(undefined); // release references for GC
    this.written = 0;
    this.epoch++;
  }
}
