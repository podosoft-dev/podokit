# AGENTS.md — {{projectName}}

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, …). Generated
by [PodoKit](https://github.com/podosoft-dev/podokit).

## Project overview

A minimal npm-workspace starter. Build it up from here — add features with the
`podo` CLI (`podo add <module>`; run `podo add` with no argument to list them).

## Commands

```bash
npm install
npm run dev      # runs workspace dev scripts
npm run build
npm run lint     # type-check
npm test
```

## Code style

- TypeScript `strict`. **No `any`** (use `unknown` + narrowing), no `@ts-ignore`.
- Explicit function return types. Conventional Commits, imperative mood, no emojis.

## PodoKit tooling

This project is managed by the `podo` CLI; `.podokit/` records how it was
assembled (do not edit by hand). Use `podo status`/`podo diff` to see your local
edits and `podo update` to pull in improvements without losing your work.
