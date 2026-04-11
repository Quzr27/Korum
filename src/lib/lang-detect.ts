/** Map file extension to Shiki language ID. */
const EXT_TO_LANG: Record<string, string> = {
  // JavaScript / TypeScript
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  mjs: "javascript", cjs: "javascript", mts: "typescript", cts: "typescript",
  // Web
  html: "html", htm: "html", css: "css", scss: "scss", sass: "sass",
  less: "less", vue: "vue", svelte: "svelte", astro: "astro",
  // Systems
  rs: "rust", go: "go", c: "c", cpp: "cpp", cc: "cpp", cxx: "cpp",
  h: "c", hpp: "cpp", hxx: "cpp", zig: "zig",
  // JVM
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala",
  groovy: "groovy", clj: "clojure",
  // .NET
  cs: "csharp", fs: "fsharp",
  // Mobile
  swift: "swift", dart: "dart",
  // Scripting
  py: "python", rb: "ruby", php: "php", lua: "lua", pl: "perl",
  r: "r", ex: "elixir", exs: "elixir", erl: "erlang",
  // Shell
  sh: "bash", bash: "bash", zsh: "bash", fish: "fish",
  ps1: "powershell", bat: "batch", cmd: "batch",
  // Data / Config
  json: "json", jsonc: "jsonc", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", csv: "csv", ini: "ini",
  // Markup / Docs
  md: "markdown", mdx: "mdx", tex: "latex", rst: "rst",
  // DevOps / Config
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  nix: "nix", cmake: "cmake",
  // Database
  sql: "sql", graphql: "graphql", gql: "graphql", prisma: "prisma",
  // Other
  vim: "viml", diff: "diff", log: "log",
};

/** Special filename → language overrides. */
const FILENAME_TO_LANG: Record<string, string> = {
  makefile: "makefile",
  dockerfile: "dockerfile",
  cmakelists: "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  justfile: "just",
};

/**
 * Detect the Shiki language ID from a file path.
 * Returns "text" for unknown extensions.
 */
export function detectLanguage(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  const filename = segments[segments.length - 1]?.toLowerCase() ?? "";

  // Check exact filename matches first
  const nameOnly = filename.replace(/\.[^.]+$/, "");
  const byName = FILENAME_TO_LANG[nameOnly] ?? FILENAME_TO_LANG[filename];
  if (byName) return byName;

  // Handle .d.ts specially
  if (filename.endsWith(".d.ts")) return "typescript";

  const ext = filename.split(".").pop() ?? "";
  return EXT_TO_LANG[ext] ?? "text";
}
