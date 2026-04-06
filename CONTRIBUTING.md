# Contributing

Thanks for your interest in Korum!

## Getting started

```bash
bun install
bunx tauri dev
```

Requires: [Rust](https://rustup.rs/), [Bun](https://bun.sh/), Xcode Command Line Tools.

## Before submitting a PR

```bash
bun run lint
bun run tsc --noEmit
bun run vitest run
cd src-tauri && cargo check
```

All four must pass.

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Follow existing code style (TypeScript strict, Tailwind, shadcn/ui)
- Don't edit files in `src/components/ui/` — use className overrides
- Test your changes with `bunx tauri dev` before submitting

## Reporting bugs

Open an issue with:
- What you did
- What you expected
- What happened instead
- macOS version + app version
