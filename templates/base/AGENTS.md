# AGENTS.md — {{projectName}}

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, …). Generated
by [PodoKit](https://github.com/podosoft-dev/podokit).

## Project overview

A minimal Bun 1.4 workspace starter with placeholder API/web scripts. Build your
own foundation here. Modules requiring the fullstack service registry, provider
consumers, or injection points cannot be added directly to this skeleton.

For a simple working full-stack app, create `fullstack` or `todo` with SQLite,
memory cache/events, local files, and local jobs. Those templates support local
providers independently of template choice and need one API process. See
[Getting Started](https://github.com/podosoft-dev/podokit/blob/main/docs/getting-started.md).

## Commands

```bash
{{packageManager}} install
{{rootRun}} build
{{rootRun}} lint     # type-check
{{rootRun}} test
```

The generated scripts are placeholders; implement them before running the app.
## Code style

- TypeScript `strict`. **No `any`** (use `unknown` + narrowing), no `@ts-ignore`.
- Explicit function return types. Conventional Commits, imperative mood, no emojis.

## PodoKit tooling

This project is managed by the `podo` CLI; `.podokit/` records how it was
assembled (do not edit by hand). Use `podo status`/`podo diff` to see your local
edits and `podo update` to pull in improvements without losing your work.
PodoKit v1 projects are Bun-only. Projects created with PodoKit 0.x remain on
their pinned 0.x CLI line and are not converted in place.
