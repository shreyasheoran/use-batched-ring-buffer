# useBatchedRingBuffer

[![CI](https://github.com/shreyasheoran/use-batched-ring-buffer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/shreyasheoran/use-batched-ring-buffer/actions/workflows/ci.yml) ![React 18 | 19](https://img.shields.io/badge/React-18%20%7C%2019-0F1B33) ![gzip ~1 KB](https://img.shields.io/badge/gzip-~1%20KB-0F1B33) ![license MIT](https://img.shields.io/badge/license-MIT-0F1B33)

A small React 18+ hook for UIs that receive a firehose of events: WebSocket alerts, logs, price ticks.

**The problem:** pushing every event into React state re-renders on every message. During a burst, the main thread can't keep up, frames drop, and the screen falls further and further behind the stream.

**The fix, in three parts:**

1. **Ring buffer.** A fixed-capacity array: O(1) writes, the oldest item is overwritten when full, so memory stays bounded however long the stream runs.
2. **Batched flushes.** Writes never touch React state. A timer publishes one immutable snapshot per window (default 250 ms) through `useSyncExternalStore`, so a burst becomes one commit and every component sees the same snapshot (no tearing).
3. **Virtualized reads.** `at(i)` reads any row in O(1) from the current snapshot, so a virtualized list only touches the rows on screen, and row indices don't shift between flushes.

This is a clean-room version of a pattern I use for real-time security dashboards. It contains no employer code.

## Install

Copy `src/ringBuffer.ts` and `src/useBatchedRingBuffer.ts` into your project. The only dependency is React 18 or later.

## Usage

```tsx
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBatchedRingBuffer } from "./useBatchedRingBuffer";

type Alert = { id: string; severity: "crit" | "high" | "med" | "low"; message: string };

export function AlertTable({ socket }: { socket: WebSocket }) {
  const alerts = useBatchedRingBuffer<Alert>(120_000, 250);
  const { pushMany } = alerts; // stable identity
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => pushMany(JSON.parse(e.data) as Alert[]);
    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket, pushMany]);

  const rows = useVirtualizer({
    count: alerts.size,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  return (
    <div ref={parentRef} style={{ height: 480, overflow: "auto" }}>
      <div style={{ height: rows.getTotalSize(), position: "relative" }}>
        {rows.getVirtualItems().map((row) => {
          const alert = alerts.at(row.index); // 0 = newest
          return (
            <div
              key={alert?.id ?? row.key}
              style={{ position: "absolute", top: 0, height: row.size, transform: `translateY(${row.start}px)` }}
            >
              {alert?.severity} · {alert?.message}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

In production, validate untrusted socket messages (for example with zod) before pushing them. The example renders text nodes only, never HTML.

## API

`useBatchedRingBuffer<T>(capacity: number, flushMs = 250)` returns:

| Value | What it does |
|---|---|
| `push(item)` | Add one item. Never renders by itself. |
| `pushMany(items)` | Add a whole frame with one scheduled flush. Only the newest `capacity` items are written. |
| `at(i)` | Item `i` in the current snapshot, 0 = newest. New identity once per flush, so memoized rows re-read. |
| `size` | Items in the current snapshot (at most `capacity`). |
| `version` | Increments once per flush. |
| `flush()` | Publish pending writes now, for example when traffic is light and latency matters more. |
| `clear()` | Empty the buffer and cancel any pending flush. |

`push`, `pushMany`, `flush` and `clear` keep the same identity across renders. `BatchedRingStore` and `RingBuffer` are exported for use outside React.

## Guarantees and trade-offs

- **Bounded memory:** at most `capacity` items are ever held.
- **Consistent reads:** `at(i)` never returns a different item from the one its snapshot saw. If a slot was overwritten by newer data after the last flush, or the buffer was cleared, it returns `undefined` until the next flush. Render a placeholder for that case.
- **Latency:** new items can wait up to `flushMs` before they appear. Choose the window for your UX, or call `flush()` when the event rate is low.
- **Validation:** an invalid `capacity` or `flushMs` throws a `RangeError` instead of silently disabling batching.
- `capacity` and `flushMs` are read on the first render only.
- It works under `StrictMode` and Fast Refresh, and renders on the server (`getServerSnapshot` is provided).
- The write counter is a JavaScript number, which stays exact for 9×10¹⁵ writes (about 285 years at a million events a second).

## Quality

Every push and pull request runs CI on React 18.3 and React 19.0: type-check, lint, tests with coverage thresholds, and the memory check.

- **Types:** TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **Lint:** ESLint (`typescript-eslint` strict + `react-hooks`), including the usage example above (`bench/bench.tsx`).
- **Tests:** 22 Vitest tests:
  - 19 unit and integration tests, covering StrictMode, no-tearing re-renders, server rendering, timer cleanup and stable identities
  - 3 property-based tests (fast-check, 500 random operation sequences each) checking the buffer against a reference model, including that a snapshot read never returns a wrong item
- **Coverage:** 100% statement, branch, function and line coverage of `src/`, enforced as a CI threshold.
- **Memory:** `npm run memcheck` confirms overwritten and cleared items are garbage-collected, with a control case.
- **Size:** about 1 KB gzipped (2.3 KB minified, React external).
- **Raw speed:** `npm run microbench` measured about 340 million pushes/s and 150 million snapshot reads/s (Node 22). The buffer itself is never the bottleneck; rendering is.

## Benchmark

`bench/bench.tsx` renders the usage example above against a naive table that calls `setState` for every alert and renders every row. A fake socket sends frames of 200 synthetic alerts every 10 ms (about 20,000 alerts/s) for 5 seconds. These are the ranges across 12 runs per mode (4 sessions of 3).

| | Naive (`setState` per event, no virtualization) | `useBatchedRingBuffer` + TanStack Virtual |
|---|---|---|
| Frame rate | 39–42 fps | 60 fps |
| React commits in 5 s | 116–126 | 21 |
| Long tasks (> 50 ms) | 1–11 per run, longest 92 ms | 0 |
| Newest alert on screen after 5 s | #22,999–#24,999 (fell behind the stream) | #99,999 every run (kept up) |
| DOM rows | about 23,000–25,000 | 25 |

Environment: headless Chromium (Playwright 1.63), React 18.3.1 production build, 2-vCPU Intel Xeon Linux VM. Numbers will differ on your machine.

## Development

```bash
npm install
npm run check        # type-check, lint, tests with coverage, memory check
npx playwright install chromium && npm run bench   # browser benchmark
npm run microbench
```

## Engineering evidence

This repository demonstrates bounded-memory event ingestion, React snapshot consistency, virtualized reads, property-based testing, browser benchmarks and accessibility-conscious integration patterns. The reusable delivery standards are documented in [software-engineering-handbook](https://github.com/shreyasheoran/software-engineering-handbook).

MIT licensed.
