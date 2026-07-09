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
bun run typecheck
bun run test
(cd src-tauri && cargo check)
(cd src-tauri && cargo test)
```

All checks must pass.

## Release branches

- Cut release prep from `main` after all intended feature/fix PRs have merged.
- Use `release/vX.Y.Z` branch names.
- Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `korum` package entry), and `src-tauri/tauri.conf.json` together.
- Update `CHANGELOG.md` and the README release badge before opening the release PR.

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
