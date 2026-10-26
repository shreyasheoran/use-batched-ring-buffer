import { StrictMode, useState, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RingBuffer } from "../src/ringBuffer";
import { BatchedRingStore, useBatchedRingBuffer } from "../src/useBatchedRingBuffer";

describe("RingBuffer", () => {
  it("rejects invalid capacity", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new RingBuffer(bad)).toThrow(RangeError);
    }
  });

  it("reads newest first", () => {
    const rb = new RingBuffer<number>(5);
    [1, 2, 3].forEach((n) => rb.push(n));
    expect(rb.size).toBe(3);
    expect(rb.at(0)).toBe(3);
    expect(rb.at(2)).toBe(1);
    expect(rb.at(3)).toBeUndefined();
    expect(rb.at(-1)).toBeUndefined();
    expect(rb.at(0.5)).toBeUndefined();
    expect(rb.toArray()).toEqual([3, 2, 1]);
  });

  it("overwrites the oldest item when full and keeps memory bounded", () => {
    const rb = new RingBuffer<number>(3);
    for (let n = 1; n <= 10; n++) rb.push(n);
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([10, 9, 8]);
  });

  it("a snapshot keeps stable indices while new items arrive", () => {
    const rb = new RingBuffer<number>(5);
    [1, 2, 3].forEach((n) => rb.push(n));
    const snap = rb.snapshot();
    rb.push(4);
    expect(rb.atSnapshot(snap, 0)).toBe(3); // still the snapshot's newest
    expect(rb.atSnapshot(snap, 2)).toBe(1);
  });

  it("never returns a wrong item for a slot overwritten after the snapshot", () => {
    const rb = new RingBuffer<number>(3);
    [1, 2, 3].forEach((n) => rb.push(n));
    const snap = rb.snapshot(); // sees [3, 2, 1]
    rb.push(4); // overwrites 1
    expect(rb.atSnapshot(snap, 0)).toBe(3);
    expect(rb.atSnapshot(snap, 2)).toBeUndefined(); // not 4
  });

  it("stale snapshots read nothing after clear", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    const stale = rb.snapshot();
    rb.clear();
    rb.push(99);
    expect(rb.atSnapshot(stale, 0)).toBeUndefined();
    expect(rb.at(0)).toBe(99);
  });
});

describe("BatchedRingStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects nonsensical flushMs instead of silently disabling batching", () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() => new BatchedRingStore<number>(10, bad)).toThrow(RangeError);
    }
    expect(() => new BatchedRingStore<number>(10, 0)).not.toThrow();
  });

  it("publishes pending writes after a dispose + resubscribe (StrictMode / Fast Refresh)", () => {
    const store = new BatchedRingStore<number>(10, 100);
    store.push(1);
    store.dispose(); // timer cancelled while a flush was pending
    const listener = vi.fn();
    store.subscribe(listener);
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().size).toBe(1);
  });

  it("pushMany larger than capacity keeps only the newest items", () => {
    const store = new BatchedRingStore<number>(3, 0);
    store.pushMany([1, 2, 3, 4, 5, 6, 7]);
    store.flush();
    const snap = store.getSnapshot();
    expect([0, 1, 2].map((i) => store.at(snap, i))).toEqual([7, 6, 5]);
  });

  it("pushMany with an empty frame schedules nothing", () => {
    const store = new BatchedRingStore<number>(3, 100);
    store.pushMany([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.getSnapshot().version).toBe(0);
  });

  it("getSnapshot is referentially stable between flushes", () => {
    const store = new BatchedRingStore<number>(10, 100);
    const a = store.getSnapshot();
    store.push(1);
    expect(store.getSnapshot()).toBe(a);
    vi.advanceTimersByTime(100);
    expect(store.getSnapshot()).not.toBe(a);
  });
});

describe("useBatchedRingBuffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders once per flush window, not once per event", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useBatchedRingBuffer<number>(120_000, 250);
    });
    const initial = renders;

    act(() => {
      for (let i = 0; i < 5_000; i++) result.current.push(i);
    });
    expect(renders).toBe(initial); // no render during the burst

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(renders).toBe(initial + 1); // exactly one commit
    expect(result.current.size).toBe(5_000);
    expect(result.current.at(0)).toBe(4_999);
    expect(result.current.version).toBe(1);
  });

  it("an unrelated re-render does not expose unflushed items (no tearing)", () => {
    const { result } = renderHook(() => {
      const [, force] = useState(0);
      return { rb: useBatchedRingBuffer<number>(10, 250), force };
    });
    act(() => {
      result.current.rb.push(1);
      vi.advanceTimersByTime(250);
    });
    act(() => result.current.rb.push(2)); // not flushed yet
    act(() => result.current.force((n) => n + 1)); // e.g. a filter change
    expect(result.current.rb.size).toBe(1);
    expect(result.current.rb.at(0)).toBe(1);
  });

  it("works under StrictMode", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useBatchedRingBuffer<number>(10, 100), { wrapper });
    act(() => {
      result.current.push(1);
      vi.advanceTimersByTime(100);
    });
    expect(result.current.size).toBe(1);
  });

  it("flush() publishes immediately", () => {
    const { result } = renderHook(() => useBatchedRingBuffer<number>(10, 10_000));
    act(() => {
      result.current.push(1);
      result.current.flush();
    });
    expect(result.current.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clear empties the buffer and cancels a pending flush", () => {
    const { result } = renderHook(() => useBatchedRingBuffer<number>(10, 250));
    act(() => {
      result.current.push(1);
      result.current.clear();
    });
    expect(result.current.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns stable function identities across renders", () => {
    const { result, rerender } = renderHook(() => useBatchedRingBuffer<number>(10, 250));
    const { push, pushMany, flush, clear } = result.current;
    rerender();
    expect(result.current.push).toBe(push);
    expect(result.current.pushMany).toBe(pushMany);
    expect(result.current.flush).toBe(flush);
    expect(result.current.clear).toBe(clear);
  });

  it("cleans up its timer on unmount", () => {
    const { result, unmount } = renderHook(() => useBatchedRingBuffer<number>(10, 250));
    act(() => result.current.push(1));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders on the server without touching timers", () => {
    function Probe() {
      const rb = useBatchedRingBuffer<number>(10);
      return <span>{rb.size}</span>;
    }
    expect(renderToString(<Probe />)).toBe("<span>0</span>");
    expect(vi.getTimerCount()).toBe(0);
  });
});
