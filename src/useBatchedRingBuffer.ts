import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { RingBuffer, type RingSnapshot } from "./ringBuffer";

export interface FlushedSnapshot extends RingSnapshot {
  /** Increments once per flush. */
  readonly version: number;
}

/**
 * Framework-agnostic store: buffers writes and publishes an immutable
 * snapshot at most once per `flushMs`. React subscribes to it through
 * useSyncExternalStore, so every component sees the same snapshot (no tearing).
 */
export class BatchedRingStore<T> {
  private readonly buffer: RingBuffer<T>;
  private readonly flushMs: number;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: FlushedSnapshot;

  constructor(capacity: number, flushMs: number) {
    if (!Number.isFinite(flushMs) || flushMs < 0) {
      throw new RangeError(`flushMs must be a finite number >= 0, got ${String(flushMs)}`);
    }
    this.buffer = new RingBuffer<T>(capacity);
    this.flushMs = flushMs;
    this.current = { ...this.buffer.snapshot(), version: 0 };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    // If writes arrived while nobody was subscribed (e.g. after a StrictMode
    // or Fast Refresh effect re-run cancelled the timer), publish them.
    if (this.isDirty()) this.schedule();
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FlushedSnapshot => this.current;

  push = (item: T): void => {
    this.buffer.push(item);
    this.schedule();
  };

  pushMany = (items: readonly T[]): void => {
    if (items.length === 0) return;
    // Only the newest `capacity` items can survive, so skip the rest.
    const start = Math.max(0, items.length - this.buffer.capacity);
    for (let i = start; i < items.length; i++) this.buffer.push(items[i] as T);
    this.schedule();
  };

  /** Publish pending writes now (e.g. when traffic is light and latency matters). */
  flush = (): void => {
    this.cancel();
    this.publish();
  };

  clear = (): void => {
    this.buffer.clear();
    this.cancel();
    this.publish();
  };

  at = (snap: RingSnapshot, i: number): T | undefined => this.buffer.atSnapshot(snap, i);

  /** Cancel timers. Safe to call more than once; pushes after dispose reschedule. */
  dispose = (): void => {
    this.cancel();
  };

  private isDirty(): boolean {
    const s = this.buffer.snapshot();
    return s.written !== this.current.written || s.epoch !== this.current.epoch;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.publish();
    }, this.flushMs);
  }

  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private publish(): void {
    this.current = { ...this.buffer.snapshot(), version: this.current.version + 1 };
    for (const listener of this.listeners) listener();
  }
}

export interface BatchedRingBuffer<T> {
  /** Add one item. Never triggers a render by itself. */
  push: (item: T) => void;
  /** Add a whole frame of items with a single scheduled flush. */
  pushMany: (items: readonly T[]) => void;
  /** Read by position in the current snapshot, 0 = newest. New identity per flush. */
  at: (i: number) => T | undefined;
  /** Items in the current snapshot (max = capacity). */
  size: number;
  /** Increments once per flush. */
  version: number;
  /** Publish pending writes immediately. */
  flush: () => void;
  clear: () => void;
}

/**
 * Buffers a high-rate stream (WebSocket alerts, logs, ticks) and re-renders
 * at most once per `flushMs` instead of once per event. Indices stay stable
 * between flushes, so a virtualized list doesn't jump while new data streams in.
 *
 * `capacity` and `flushMs` are read once, on first render.
 */
export function useBatchedRingBuffer<T>(capacity: number, flushMs = 250): BatchedRingBuffer<T> {
  const [store] = useState(() => new BatchedRingStore<T>(capacity, flushMs));
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => store.dispose, [store]);

  const at = useCallback((i: number) => store.at(snap, i), [store, snap]);

  return {
    push: store.push,
    pushMany: store.pushMany,
    flush: store.flush,
    clear: store.clear,
    at,
    size: snap.size,
    version: snap.version,
  };
}
