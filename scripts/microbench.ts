// Run: npm run microbench
import { RingBuffer } from "../src/ringBuffer";
const N = 5_000_000;
const rb = new RingBuffer<{ id: number }>(120_000);
const items = Array.from({ length: 1000 }, (_, id) => ({ id }));
for (let i = 0; i < 200_000; i++) rb.push(items[i % 1000] as { id: number }); // warm up
let t = performance.now();
for (let i = 0; i < N; i++) rb.push(items[i % 1000] as { id: number });
const pushMs = performance.now() - t;
const snap = rb.snapshot();
let sink = 0;
t = performance.now();
for (let i = 0; i < N; i++) sink += rb.atSnapshot(snap, i % 120_000)?.id ?? 0;
const readMs = performance.now() - t;
console.log(JSON.stringify({ pushesPerSec: Math.round(N / (pushMs / 1000)), readsPerSec: Math.round(N / (readMs / 1000)), sink: sink > 0 }));
