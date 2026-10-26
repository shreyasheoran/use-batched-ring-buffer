// Browser benchmark: naive "setState per event" vs useBatchedRingBuffer + TanStack Virtual.
// The AlertTable below is the README usage example plus a commit counter.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBatchedRingBuffer } from "../src/useBatchedRingBuffer";

type Alert = { id: string; severity: "crit" | "high" | "med" | "low"; message: string };

// ---- README example (unchanged apart from the export and the commit counter) ----
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

  (window as unknown as { __commits: number }).__commits++;
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
// ---- end README example ----

function NaiveTable({ socket }: { socket: WebSocket }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      for (const a of JSON.parse(e.data) as Alert[]) setAlerts((prev) => [a, ...prev]); // one update per event
    };
    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket]);
  (window as unknown as { __commits: number }).__commits++;
  return (
    <div style={{ height: 480, overflow: "auto" }}>
      {alerts.map((a) => (
        <div key={a.id} style={{ height: 32 }}>
          {a.severity} · {a.message}
        </div>
      ))}
    </div>
  );
}

// A fake socket: frames of `perFrame` alerts every `intervalMs`.
function fakeSocket(perFrame: number, intervalMs: number, durationMs: number) {
  const target = new EventTarget();
  let seq = 0;
  const sev = ["crit", "high", "med", "low"] as const;
  const timer = setInterval(() => {
    const frame: Alert[] = [];
    for (let i = 0; i < perFrame; i++, seq++) {
      frame.push({ id: String(seq), severity: sev[seq % 4] ?? "low", message: `synthetic alert ${seq}` });
    }
    target.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }, intervalMs);
  setTimeout(() => clearInterval(timer), durationMs);
  return target as unknown as WebSocket;
}

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "batched";
const w = window as unknown as { __commits: number; __done: boolean; __longTasks: number[] };
w.__commits = 0;
w.__longTasks = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) w.__longTasks.push(e.duration);
}).observe({ type: "longtask", buffered: true });

const socket = fakeSocket(Number(params.get("perFrame") ?? 50), Number(params.get("intervalMs") ?? 10), Number(params.get("durationMs") ?? 5000));
createRoot(document.getElementById("root") as HTMLElement).render(
  mode === "naive" ? <NaiveTable socket={socket} /> : <AlertTable socket={socket} />,
);
