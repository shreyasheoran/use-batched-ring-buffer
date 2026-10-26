// Run: npm run memcheck
// Checks that the buffer does not keep overwritten or cleared items alive.
import { RingBuffer } from "../src/ringBuffer";

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("run with node --expose-gc");

async function collect(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    gc?.();
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function main(): Promise<void> {
  const results: Record<string, boolean> = {};

  const a = new RingBuffer<object>(2);
  let first: object | null = { big: new Array(1e5).fill(0) };
  const refA = new WeakRef(first);
  a.push(first);
  first = null;
  a.push({});
  a.push({}); // overwrites the first item
  await collect();
  results["released after overwrite"] = refA.deref() === undefined;

  const b = new RingBuffer<object>(4);
  let item: object | null = { big: new Array(1e5).fill(0) };
  const refB = new WeakRef(item);
  b.push(item);
  item = null;
  b.clear();
  await collect();
  results["released after clear"] = refB.deref() === undefined;

  const c = new RingBuffer<object>(4);
  let kept: object | null = { big: 1 };
  const refC = new WeakRef(kept);
  c.push(kept);
  kept = null;
  await collect();
  results["retained while still in the buffer (control)"] = refC.deref() !== undefined;

  console.table(results);
  if (Object.values(results).some((ok) => !ok)) throw new Error("memory check failed");
}

void main();
