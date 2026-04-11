/**
 * Material file icon mapping for FileTree.
 * Maps file extensions, filenames, and folder names to @iconify/react icon IDs.
 */

import type { FileEntry } from "@/types";

// biome-ignore format: icon maps
const EXT_ICON_MAP: Record<string, string> = {
  // ── JavaScript / TypeScript ──
  ts: "typescript", tsx: "react-ts", js: "javascript", jsx: "react",
  mjs: "javascript", cjs: "javascript", mts: "typescript", cts: "typescript",
  d_ts: "typescript-def",
  // ── Web ──
  html: "html", htm: "html", css: "css", scss: "sass", sass: "sass",
  less: "less", styl: "stylus", postcss: "postcss",
  vue: "vue", svelte: "svelte", astro: "astro", njk: "nunjucks",
  ejs: "ejs", hbs: "handlebars", pug: "pug", twig: "twig",
  // ── Systems ──
  rs: "rust", go: "go", c: "c", cpp: "cpp", cc: "cpp", cxx: "cpp",
  h: "h", hpp: "hpp", hxx: "hpp", zig: "zig", nim: "nim",
  asm: "assembly", s: "assembly", wasm: "assembly",
  // ── JVM ──
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala",
  groovy: "groovy", gradle: "gradle", clj: "clojure", cljs: "clojure",
  // ── .NET ──
  cs: "csharp", fs: "fsharp", vb: "csharp", csproj: "csharp", sln: "csharp",
  xaml: "xml",
  // ── Mobile ──
  swift: "swift", m: "objective-c", mm: "objective-cpp",
  dart: "dart",
  // ── Scripting ──
  py: "python", pyw: "python", pyi: "python", pyx: "python",
  rb: "ruby", erb: "ruby", rake: "ruby", gemspec: "ruby",
  php: "php", pl: "perl", pm: "perl",
  lua: "lua", r: "r", rmd: "r", jl: "julia",
  ex: "elixir", exs: "elixir", eex: "elixir", heex: "elixir",
  erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell", ml: "ocaml", mli: "ocaml",
  // ── Shell ──
  sh: "console", bash: "console", zsh: "console", fish: "console",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  bat: "console", cmd: "console",
  // ── Data / Config ──
  json: "json", jsonc: "json", json5: "json",
  yaml: "yaml", yml: "yaml",
  toml: "toml", ini: "settings", cfg: "settings", conf: "settings",
  xml: "xml", xsl: "xml", xsd: "xml", dtd: "xml", plist: "xml",
  csv: "document", tsv: "document",
  env: "tune",
  // ── Markup / Docs ──
  md: "markdown", mdx: "mdx", txt: "document",
  rst: "document", adoc: "document", tex: "tex", latex: "tex",
  pdf: "pdf", doc: "word", docx: "word", xls: "document", xlsx: "document",
  ppt: "powerpoint", pptx: "powerpoint",
  // ── Database ──
  sql: "database", sqlite: "database", db: "database",
  prisma: "prisma",
  // ── GraphQL / API ──
  graphql: "graphql", gql: "graphql",
  proto: "proto", grpc: "proto",
  // ── Images ──
  svg: "svg", png: "image", jpg: "image", jpeg: "image",
  gif: "image", webp: "image", ico: "image", bmp: "image",
  avif: "image", tiff: "image", tif: "image",
  // ── Audio / Video ──
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", aac: "audio",
  mp4: "video", webm: "video", mov: "video", avi: "video", mkv: "video",
  // ── Fonts ──
  ttf: "font", otf: "font", woff: "font", woff2: "font", eot: "font",
  // ── Archives ──
  zip: "zip", tar: "zip", gz: "zip", bz2: "zip", xz: "zip",
  "7z": "zip", rar: "zip", tgz: "zip",
  // ── DevOps / CI ──
  dockerfile: "docker", tf: "terraform", hcl: "terraform",
  nix: "nix",
  // ── Misc ──
  lock: "lock", log: "log", diff: "diff", patch: "diff",
  map: "json", snap: "document",
  stories_tsx: "storybook", stories_ts: "storybook",
  test_ts: "test-ts", test_tsx: "test-ts",
  spec_ts: "test-ts", spec_tsx: "test-ts",
  test_js: "test-js", spec_js: "test-js",
};

// biome-ignore format: filename map
const NAME_ICON_MAP: Record<string, string> = {
  // ── Package managers ──
  "package.json": "nodejs", "package-lock.json": "nodejs",
  "bun.lock": "bun", "bun.lockb": "bun",
  "yarn.lock": "yarn", ".yarnrc": "yarn", ".yarnrc.yml": "yarn",
  "pnpm-lock.yaml": "pnpm", "pnpm-workspace.yaml": "pnpm", ".pnpmfile.cjs": "pnpm",
  "deno.json": "deno", "deno.jsonc": "deno", "deno.lock": "deno",
  // ── TypeScript / JavaScript ──
  "tsconfig.json": "tsconfig", "tsconfig.node.json": "tsconfig",
  "tsconfig.build.json": "tsconfig", "tsconfig.app.json": "tsconfig",
  "jsconfig.json": "jsconfig",
  // ── Build tools ──
  "vite.config.ts": "vite", "vite.config.js": "vite", "vite.config.mts": "vite",
  "vitest.config.ts": "vitest", "vitest.config.js": "vitest", "vitest.config.mts": "vitest",
  "webpack.config.js": "webpack", "webpack.config.ts": "webpack",
  "rollup.config.js": "rollup", "rollup.config.ts": "rollup", "rollup.config.mjs": "rollup",
  "esbuild.config.js": "javascript", "turbo.json": "turborepo",
  "next.config.js": "next", "next.config.mjs": "next", "next.config.ts": "next",
  "nuxt.config.ts": "nuxt", "nuxt.config.js": "nuxt",
  "svelte.config.js": "svelte", "astro.config.mjs": "astro", "astro.config.ts": "astro",
  "remix.config.js": "remix",
  // ── Styling ──
  "tailwind.config.js": "tailwindcss", "tailwind.config.ts": "tailwindcss", "tailwind.config.mjs": "tailwindcss",
  "postcss.config.js": "postcss", "postcss.config.mjs": "postcss", "postcss.config.cjs": "postcss",
  ".stylelintrc": "stylelint", "stylelint.config.js": "stylelint",
  // ── Linting / Formatting ──
  ".eslintrc": "eslint", ".eslintrc.js": "eslint", ".eslintrc.json": "eslint", ".eslintrc.cjs": "eslint",
  "eslint.config.js": "eslint", "eslint.config.mjs": "eslint", "eslint.config.ts": "eslint",
  ".eslintignore": "eslint",
  ".prettierrc": "prettier", ".prettierrc.js": "prettier", ".prettierrc.json": "prettier",
  "prettier.config.js": "prettier", "prettier.config.mjs": "prettier", ".prettierignore": "prettier",
  "biome.json": "biome", "biome.jsonc": "biome",
  ".editorconfig": "editorconfig",
  // ── Git ──
  ".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git",
  ".gitkeep": "git", ".gitpod.yml": "git",
  // ── Docker ──
  "dockerfile": "docker", "docker-compose.yml": "docker", "docker-compose.yaml": "docker",
  "compose.yml": "docker", "compose.yaml": "docker",
  ".dockerignore": "docker",
  // ── CI/CD ──
  "jenkinsfile": "jenkins", ".travis.yml": "travis",
  "azure-pipelines.yml": "azure-pipelines",
  ".gitlab-ci.yml": "gitlab",
  "vercel.json": "vercel", "netlify.toml": "netlify",
  // ── Rust ──
  "cargo.toml": "rust", "cargo.lock": "rust", "rust-toolchain.toml": "rust",
  "clippy.toml": "rust", "rustfmt.toml": "rust",
  // ── Python ──
  "requirements.txt": "python-misc", "setup.py": "python-misc", "setup.cfg": "python-misc",
  "pyproject.toml": "python-misc", "pipfile": "python-misc", "pipfile.lock": "python-misc",
  "poetry.lock": "python-misc", ".python-version": "python-misc",
  "manage.py": "django",
  // ── Ruby ──
  "gemfile": "ruby", "gemfile.lock": "ruby", "rakefile": "ruby",
  ".rubocop.yml": "ruby",
  // ── Go ──
  "go.mod": "go", "go.sum": "go",
  // ── PHP ──
  "composer.json": "json", "composer.lock": "lock",
  "artisan": "laravel", ".php-cs-fixer.php": "php",
  // ── Java / Kotlin ──
  "build.gradle": "gradle", "build.gradle.kts": "gradle",
  "settings.gradle": "gradle", "settings.gradle.kts": "gradle",
  "pom.xml": "maven", "gradlew": "gradle",
  // ── .NET ──
  "global.json": "csharp", "nuget.config": "nuget",
  // ── Mobile ──
  "podfile": "ruby", "podfile.lock": "lock",
  "pubspec.yaml": "dart", "pubspec.lock": "dart",
  "androidmanifest.xml": "android",
  // ── Docs ──
  "readme.md": "readme", "readme": "readme",
  "license": "certificate", "license.md": "certificate", "license.txt": "certificate",
  "changelog.md": "changelog", "changelog": "changelog",
  "contributing.md": "document", "authors": "document", "contributors": "document",
  "claude.md": "robot", "agents.md": "robot",
  // ── Env / Secrets ──
  ".env": "tune", ".env.local": "tune", ".env.development": "tune",
  ".env.production": "tune", ".env.staging": "tune", ".env.test": "tune",
  ".env.example": "tune",
  // ── Testing ──
  "jest.config.js": "jest", "jest.config.ts": "jest", "jest.setup.js": "jest",
  ".nycrc": "istanbul", "cypress.config.ts": "cypress", "cypress.config.js": "cypress",
  "playwright.config.ts": "playwright",
  // ── Misc config ──
  ".npmrc": "npm", ".nvmrc": "nodejs", ".node-version": "nodejs",
  "components.json": "json", ".browserslistrc": "browserlist",
  "babel.config.js": "babel", ".babelrc": "babel",
  ".swcrc": "swc", "nx.json": "nx",
  "lerna.json": "lerna", ".commitlintrc": "commitlint",
  "renovate.json": "renovate", ".releaserc": "semantic-release",
  "index.html": "html",
  "makefile": "makefile", "cmakelists.txt": "cmake",
  "vagrantfile": "vagrant",
};

// biome-ignore format: folder map
const FOLDER_ICON_MAP: Record<string, string> = {
  // ── Source ──
  src: "folder-src", source: "folder-src", sources: "folder-src",
  lib: "folder-lib", libs: "folder-lib", packages: "folder-lib",
  app: "folder-app", apps: "folder-app",
  // ── UI / Components ──
  components: "folder-components", component: "folder-components",
  ui: "folder-layout", layout: "folder-layout", layouts: "folder-layout",
  views: "folder-views", pages: "folder-views", screens: "folder-views",
  widgets: "folder-components", partials: "folder-components",
  templates: "folder-template",
  // ── Styling ──
  styles: "folder-css", css: "folder-css", sass: "folder-css", scss: "folder-css",
  // ── Assets ──
  assets: "folder-images", images: "folder-images", img: "folder-images",
  icons: "folder-images", static: "folder-images", media: "folder-images",
  public: "folder-public",
  fonts: "folder-font", font: "folder-font",
  // ── Code organization ──
  utils: "folder-utils", util: "folder-utils", helpers: "folder-helper",
  tools: "folder-tools", shared: "folder-shared", common: "folder-shared",
  core: "folder-core", internal: "folder-core",
  hooks: "folder-hook", composables: "folder-hook",
  services: "folder-api", api: "folder-api", endpoints: "folder-api",
  routes: "folder-routes", router: "folder-routes", middleware: "folder-middleware",
  controllers: "folder-controller", models: "folder-database",
  // ── Types ──
  types: "folder-typescript", typings: "folder-typescript", interfaces: "folder-typescript",
  // ── State ──
  store: "folder-context", stores: "folder-context", state: "folder-context",
  context: "folder-context", contexts: "folder-context",
  redux: "folder-redux-reducer", actions: "folder-redux-reducer", reducers: "folder-redux-reducer",
  // ── Testing ──
  tests: "folder-test", test: "folder-test", __tests__: "folder-test",
  __mocks__: "folder-test", __snapshots__: "folder-test",
  fixtures: "folder-test", e2e: "folder-test", cypress: "folder-test",
  spec: "folder-test", coverage: "folder-coverage",
  // ── Build / Output ──
  dist: "folder-dist", build: "folder-dist", out: "folder-dist", output: "folder-dist",
  target: "folder-dist", bin: "folder-dist", ".next": "folder-dist",
  ".nuxt": "folder-dist", ".svelte-kit": "folder-dist",
  // ── Config ──
  config: "folder-config", configs: "folder-config", settings: "folder-config",
  ".config": "folder-config", capabilities: "folder-config",
  // ── Node / Dependencies ──
  node_modules: "folder-node",
  // ── Git / VCS ──
  ".git": "folder-git", ".github": "folder-github",
  ".gitlab": "folder-gitlab", ".husky": "folder-git",
  // ── IDE ──
  ".vscode": "folder-vscode", ".idea": "folder-intellij",
  // ── Docs ──
  docs: "folder-docs", doc: "folder-docs", documentation: "folder-docs",
  wiki: "folder-docs", guides: "folder-docs",
  // ── Scripts ──
  scripts: "folder-scripts", tasks: "folder-scripts",
  // ── i18n / l10n ──
  locales: "folder-i18n", locale: "folder-i18n",
  i18n: "folder-i18n", lang: "folder-i18n", translations: "folder-i18n",
  // ── Database ──
  migrations: "folder-database", db: "folder-database", database: "folder-database",
  prisma: "folder-prisma", seeds: "folder-database",
  // ── Server ──
  server: "folder-server", backend: "folder-server",
  // ── Client ──
  client: "folder-client", frontend: "folder-client",
  // ── Auth ──
  auth: "folder-secure", security: "folder-secure",
  // ── Auto-generated ──
  gen: "folder-generator", generated: "folder-generator", __generated__: "folder-generator",
  // ── CI/CD ──
  ".circleci": "folder-ci", ".buildkite": "folder-ci",
  // ── Cloud / Infra ──
  ".aws": "folder-aws", ".azure": "folder-azure-pipelines",
  terraform: "folder-terraform", infra: "folder-terraform",
  k8s: "folder-kubernetes", kubernetes: "folder-kubernetes",
  // ── Logs ──
  logs: "folder-log", log: "folder-log",
  // ── Korum-specific ──
  branding: "folder-images", canvas: "folder-views",
  ".claude": "folder-robot",
};

/** Resolve the Material icon name for a file or folder entry. */
export function getFileIconName(entry: FileEntry, isExpanded?: boolean): string {
  if (entry.is_dir) {
    const folderName = entry.name.toLowerCase();
    const base = FOLDER_ICON_MAP[folderName] ?? "folder-other";
    return isExpanded ? `${base}-open` : base;
  }
  const nameLower = entry.name.toLowerCase();
  const byName = NAME_ICON_MAP[nameLower];
  if (byName) return byName;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_ICON_MAP[ext] ?? "document";
}

/** Git status badge colors. */
export const GIT_STATUS_COLORS: Record<string, string> = {
  M: "#F59E0B",
  A: "#2dcf67",
  D: "#FF5F57",
  "?": "#2dcf6799",
  R: "#58a6ff",
};
