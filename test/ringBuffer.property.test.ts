// Model-based tests: random sequences of operations are run against the real
// RingBuffer and a trivially-correct reference model, and the two must agree.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RingBuffer, type RingSnapshot } from "../src/ringBuffer";

type Op =
  | { kind: "push"; value: number }
  | { kind: "clear" }
  | { kind: "snapshot" }
  | { kind: "read"; snapIndex: number; i: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.integer().map((value) => ({ kind: "push" as const, value })) },
  { weight: 1, arbitrary: fc.constant({ kind: "clear" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "snapshot" as const }) },
  {
    weight: 4,
    arbitrary: fc
      .record({ snapIndex: fc.nat(20), i: fc.integer({ min: -2, max: 40 }) })
      .map((r) => ({ kind: "read" as const, ...r })),
  },
);

describe("RingBuffer (property-based)", () => {
  it("live reads always match a reference model", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), fc.array(opArb, { maxLength: 300 }), (capacity, ops) => {
        const rb = new RingBuffer<number>(capacity);
        let model: number[] = []; // newest first, at most `capacity`
        for (const op of ops) {
          if (op.kind === "push") {
            rb.push(op.value);
            model = [op.value, ...model].slice(0, capacity);
          } else if (op.kind === "clear") {
            rb.clear();
            model = [];
          }
          expect(rb.size).toBe(model.length);
          expect(rb.toArray()).toEqual(model);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a snapshot read is either the exact item the snapshot saw, or undefined", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), fc.array(opArb, { maxLength: 300 }), (capacity, ops) => {
        const rb = new RingBuffer<number>(capacity);
        let model: number[] = [];
        const snaps: Array<{ snap: RingSnapshot; seen: number[] }> = [];
        for (const op of ops) {
          if (op.kind === "push") {
            rb.push(op.value);
            model = [op.value, ...model].slice(0, capacity);
          } else if (op.kind === "clear") {
            rb.clear();
            model = [];
          } else if (op.kind === "snapshot") {
            snaps.push({ snap: rb.snapshot(), seen: [...model] });
          } else if (snaps.length > 0) {
            const { snap, seen } = snaps[op.snapIndex % snaps.length] as { snap: RingSnapshot; seen: number[] };
            const got = rb.atSnapshot(snap, op.i);
            if (op.i < 0 || op.i >= seen.length) expect(got).toBeUndefined();
            else if (got !== undefined) expect(got).toBe(seen[op.i]); // never a wrong item
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a snapshot stays fully readable until more than (capacity - size) newer items arrive", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 32 }), fc.nat(64), fc.nat(64), (capacity, before, after) => {
        const rb = new RingBuffer<number>(capacity);
        for (let n = 0; n < before; n++) rb.push(n);
        const snap = rb.snapshot();
        const extra = Math.min(after, capacity - snap.size);
        for (let n = 0; n < extra; n++) rb.push(1_000 + n);
        for (let i = 0; i < snap.size; i++) expect(rb.atSnapshot(snap, i)).toBe(before - 1 - i);
      }),
      { numRuns: 500 },
    );
  });
});
