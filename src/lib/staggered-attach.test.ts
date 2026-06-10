import { describe, expect, it } from "vitest";
import { advanceAttachSet, liveIdsSignature } from "./staggered-attach";

const set = (...ids: string[]) => new Set(ids);

describe("advanceAttachSet", () => {
  it("prunes ids not in target immediately, even mid-stagger", () => {
    const { next, done } = advanceAttachSet(set("a", "b", "c"), set("a"), null, 1);
    expect(next).toEqual(set("a"));
    expect(done).toBe(true);
  });

  it("admits at most batchSize new ids per step", () => {
    const { next, done } = advanceAttachSet(set(), set("a", "b", "c"), null, 1);
    expect(next.size).toBe(1);
    expect(done).toBe(false);
  });

  it("attaches the priority id first", () => {
    const { next } = advanceAttachSet(set(), set("a", "b", "c"), "c", 1);
    expect(next).toEqual(set("c"));
  });

  it("ignores a priority id that is not in target", () => {
    const { next } = advanceAttachSet(set(), set("a", "b"), "zombie", 1);
    expect(next).toEqual(set("a"));
  });

  it("does not re-admit an already attached priority id", () => {
    const { next } = advanceAttachSet(set("c"), set("a", "b", "c"), "c", 1);
    expect(next).toEqual(set("c", "a"));
  });

  it("converges to target across repeated steps", () => {
    const target = set("a", "b", "c", "d");
    let current: ReadonlySet<string> = set();
    let steps = 0;
    let done = false;
    while (!done) {
      const result = advanceAttachSet(current, target, "d", 1);
      current = result.next;
      done = result.done;
      steps += 1;
      expect(steps).toBeLessThan(10);
    }
    expect(current).toEqual(target);
    expect(steps).toBe(4);
  });

  it("returns the same reference when nothing changes", () => {
    const current = set("a", "b");
    const { next, done } = advanceAttachSet(current, set("a", "b"), "a", 2);
    expect(next).toBe(current);
    expect(done).toBe(true);
  });

  it("prunes and admits in the same step on viewport teleport", () => {
    const { next, done } = advanceAttachSet(
      set("old1", "old2", "old3"),
      set("new1", "new2", "new3"),
      "new2",
      1,
    );
    expect(next).toEqual(set("new2"));
    expect(done).toBe(false);
  });

  it("reports done immediately when already converged and empty", () => {
    const current = set();
    const { next, done } = advanceAttachSet(current, set(), null, 1);
    expect(next).toBe(current);
    expect(done).toBe(true);
  });
});

describe("liveIdsSignature", () => {
  it("is order-insensitive and distinguishes different sets", () => {
    expect(liveIdsSignature(set("b", "a"))).toBe(liveIdsSignature(set("a", "b")));
    expect(liveIdsSignature(set("a"))).not.toBe(liveIdsSignature(set("a", "b")));
    expect(liveIdsSignature(set())).toBe("");
  });
});
