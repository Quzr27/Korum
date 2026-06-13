import { describe, expect, it } from "vitest";
import {
  createCodeLineHtmlCache,
  renderCodeLineHtml,
  renderPlainCodeLineHtml,
} from "./code-window-rendering";

describe("code-window-rendering", () => {
  it("escapes token content and only emits safe Shiki colors", () => {
    expect(renderCodeLineHtml([
      { content: "<tag>&\"", color: "#ff00aa" },
      { content: " unsafe", color: "url(javascript:alert(1))" },
    ])).toBe('<span style="color:#ff00aa">&lt;tag&gt;&amp;&quot;</span><span> unsafe</span>');
  });

  it("renders empty lines as a non-breaking space", () => {
    expect(renderCodeLineHtml([])).toBe("&nbsp;");
    expect(renderPlainCodeLineHtml("")).toBe("&nbsp;");
  });

  it("caches token line HTML by token array identity", () => {
    const cache = createCodeLineHtmlCache(4);
    const tokens = [{ content: "const x = 1;", color: "#79c0ff" }];

    const first = cache.getTokenLine(tokens);
    const second = cache.getTokenLine(tokens);

    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });
});
