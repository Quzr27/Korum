import { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { VisibilityProvider, useVisibility } from "./visibility-context";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let latestCtx: ReturnType<typeof useVisibility> | null = null;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function CaptureContext() {
  latestCtx = useVisibility();
  return null;
}

function mountProvider() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <VisibilityProvider>
        <CaptureContext />
      </VisibilityProvider>,
    );
  });
  mountedRoots.push({ root, container });
  return latestCtx!;
}

function setVisibilityState(state: string) {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
}

let originalVisibilityState: string;

beforeEach(() => {
  originalVisibilityState = document.visibilityState;
  latestCtx = null;
});

afterEach(() => {
  for (const { root, container } of mountedRoots) {
    act(() => root.unmount());
    container.remove();
  }
  mountedRoots.length = 0;
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
});

describe("VisibilityProvider", () => {
  it("calls registered callbacks on focus event", () => {
    const ctx = mountProvider();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    act(() => {
      ctx.register("t1", cb1);
      ctx.register("t2", cb2);
    });

    setVisibilityState("visible");
    act(() => window.dispatchEvent(new Event("focus")));

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("does not call unregistered callbacks", () => {
    const ctx = mountProvider();
    const cb = vi.fn();

    act(() => {
      ctx.register("t1", cb);
      ctx.unregister("t1");
    });

    setVisibilityState("visible");
    act(() => window.dispatchEvent(new Event("focus")));

    expect(cb).not.toHaveBeenCalled();
  });

  it("does not call callbacks when visibilityState is hidden", () => {
    const ctx = mountProvider();
    const cb = vi.fn();

    act(() => ctx.register("t1", cb));

    setVisibilityState("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(cb).not.toHaveBeenCalled();
  });

  it("calls callbacks on visibilitychange when visible", () => {
    const ctx = mountProvider();
    const cb = vi.fn();

    act(() => ctx.register("t1", cb));

    setVisibilityState("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(cb).toHaveBeenCalledOnce();
  });
});
