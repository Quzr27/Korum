import { describe, it, expect, vi, beforeEach } from "vitest";
import { CAN_OVERRIDE_CLIENT_COORDS, adjustMouseForZoom } from "./xterm-mouse-compat";

describe("xterm-mouse-compat", () => {
  describe("CAN_OVERRIDE_CLIENT_COORDS", () => {
    it("should be true in jsdom (supports configurable MouseEvent props)", () => {
      expect(CAN_OVERRIDE_CLIENT_COORDS).toBe(true);
    });
  });

  describe("adjustMouseForZoom", () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement("div");
      // Mock getBoundingClientRect — container at (100, 50)
      vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: 50,
        right: 700,
        bottom: 450,
        width: 600,
        height: 400,
        x: 100,
        y: 50,
        toJSON: () => {},
      });
    });

    it("should be a no-op at zoom === 1", () => {
      const e = new MouseEvent("mousedown", { clientX: 300, clientY: 200 });
      adjustMouseForZoom(e, container, 1);
      expect(e.clientX).toBe(300);
      expect(e.clientY).toBe(200);
    });

    it("should adjust coordinates at zoom = 0.5", () => {
      // Container rect.left=100, click at clientX=200 → offset=100 screen px
      // At zoom=0.5, unscaled offset = 100/0.5 = 200
      // Adjusted clientX = 100 + 200 = 300
      const e = new MouseEvent("mousedown", { clientX: 200, clientY: 150 });
      adjustMouseForZoom(e, container, 0.5);
      expect(e.clientX).toBe(300); // 100 + (200-100)/0.5
      expect(e.clientY).toBe(250); // 50 + (150-50)/0.5
    });

    it("should adjust coordinates at zoom = 2", () => {
      // offset=200 screen px, at zoom=2 → unscaled = 200/2 = 100
      // Adjusted clientX = 100 + 100 = 200
      const e = new MouseEvent("mousedown", { clientX: 300, clientY: 250 });
      adjustMouseForZoom(e, container, 2);
      expect(e.clientX).toBe(200); // 100 + (300-100)/2
      expect(e.clientY).toBe(150); // 50 + (250-50)/2
    });

    it("should not modify when click is exactly at container origin", () => {
      const e = new MouseEvent("mousedown", { clientX: 100, clientY: 50 });
      adjustMouseForZoom(e, container, 0.8);
      expect(e.clientX).toBe(100); // offset=0, 100 + 0/0.8 = 100
      expect(e.clientY).toBe(50); // offset=0, 50 + 0/0.8 = 50
    });
  });
});
