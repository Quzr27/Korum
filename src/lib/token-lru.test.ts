import { describe, expect, it } from "vitest";
import { createTokenLRU } from "./token-lru";

describe("createTokenLRU", () => {
  it("returns undefined for a missing key and stores values", () => {
    const lru = createTokenLRU<string>(100);
    expect(lru.get("a")).toBeUndefined();
    lru.set("a", "A", 10);
    expect(lru.get("a")).toBe("A");
    expect(lru.size).toBe(1);
    expect(lru.bytes).toBe(10);
  });

  it("evicts the least recently used entry when over budget", () => {
    const lru = createTokenLRU<string>(30);
    lru.set("a", "A", 10);
    lru.set("b", "B", 10);
    lru.set("c", "C", 10);
    lru.set("d", "D", 10); // 40 bytes > 30 — evicts "a"
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe("B");
    expect(lru.bytes).toBe(30);
  });

  it("get refreshes recency so the read entry survives eviction", () => {
    const lru = createTokenLRU<string>(30);
    lru.set("a", "A", 10);
    lru.set("b", "B", 10);
    lru.set("c", "C", 10);
    lru.get("a"); // refresh "a" — "b" is now oldest
    lru.set("d", "D", 10);
    expect(lru.get("a")).toBe("A");
    expect(lru.get("b")).toBeUndefined();
  });

  it("replaces an existing key without double-counting bytes", () => {
    const lru = createTokenLRU<string>(100);
    lru.set("a", "A1", 40);
    lru.set("a", "A2", 20);
    expect(lru.get("a")).toBe("A2");
    expect(lru.size).toBe(1);
    expect(lru.bytes).toBe(20);
  });

  it("does not cache an entry larger than the whole budget", () => {
    const lru = createTokenLRU<string>(50);
    lru.set("big", "BIG", 51);
    expect(lru.get("big")).toBeUndefined();
    expect(lru.size).toBe(0);
    expect(lru.bytes).toBe(0);
  });

  it("evicts multiple oldest entries to fit one large entry", () => {
    const lru = createTokenLRU<string>(50);
    lru.set("a", "A", 20);
    lru.set("b", "B", 20);
    lru.set("c", "C", 45); // needs both "a" and "b" gone
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("c")).toBe("C");
    expect(lru.bytes).toBe(45);
  });

  it("never evicts the entry that was just added", () => {
    const lru = createTokenLRU<string>(50);
    lru.set("a", "A", 50);
    expect(lru.get("a")).toBe("A");
    lru.set("b", "B", 50);
    expect(lru.get("b")).toBe("B");
    expect(lru.get("a")).toBeUndefined();
    expect(lru.bytes).toBe(50);
  });
});
