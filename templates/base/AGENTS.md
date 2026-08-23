# AGENTS.md — {{projectName}}

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, …). Generated
by [PodoKit](https://github.com/podosoft-dev/podokit).

## Project overview

A minimal {{runtime}}/{{packageManager}} workspace starter. Build it up from here — add features with the
`podo` CLI (`podo add <module>`; run `podo add` with no argument to list them).

## Commands

```bash
{{packageManager}} install
{{rootRun}} dev      # runs workspace dev scripts
{{rootRun}} build
{{rootRun}} lint     # type-check
{{rootRun}} test
```

## Code style

- TypeScript `strict`. **No `any`** (use `unknown` + narrowing), no `@ts-ignore`.
- Explicit function return types. Conventional Commits, imperative mood, no emojis.

## PodoKit tooling

This project is managed by the `podo` CLI; `.podokit/` records how it was
assembled (do not edit by hand). Use `podo status`/`podo diff` to see your local
edits and `podo update` to pull in improvements without losing your work.
Use `podo runtime set node|bun` to preview a runtime conversion and add
`--apply` only after reviewing its managed-file and validation plan.
