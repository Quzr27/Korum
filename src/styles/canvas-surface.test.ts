import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const canvasCss = readFileSync(join(process.cwd(), "src/styles/canvas.css"), "utf8");

function cssRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`, "m").exec(canvasCss);
  return match?.groups?.body ?? "";
}

describe("canvas surface CSS", () => {
  it("renders the selected surface mesh outside war-room mode", () => {
    const meshLayer = cssRuleBody(".canvas-bg::before");

    expect(meshLayer).toContain("background: var(--canvas-mesh);");
    expect(meshLayer).toContain("opacity: var(--canvas-mesh-opacity);");
  });
});
