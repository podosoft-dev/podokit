# Contributing to PodoKit

Thanks for your interest in contributing! PodoKit is in early development, so contributions and feedback are very welcome.

## Ground rules

- Be respectful. See our [Code of Conduct](CODE_OF_CONDUCT.md).
- Do not submit credentials, secrets, proprietary code, or copied internal code.
- All contributions must comply with the project [license](LICENSE) (Apache-2.0).

## Reporting bugs

Found a problem in a generated project, the `podo` CLI, or the templates? See
[docs/reporting-bugs.md](docs/reporting-bugs.md). It has an issue-form link for the
browser, a copy-paste report template, and a `gh` recipe so a person **or an AI
coding agent** can file a well-formed report from the terminal. Security issues go
through [SECURITY.md](SECURITY.md), not public issues.

## Development

This repository is an npm workspace.

```bash
npm install
npm run build
npm run lint
npm test
```

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `docs`, `refactor`, `style`, `test`, `chore`.
- Keep the subject line imperative and under ~50 characters.
- One logical change per commit.

## Changesets

This is a multi-package monorepo, and releases are managed with
[Changesets](https://github.com/changesets/changesets). If your change affects a
**published package** (anything under `packages/*` — the `podo` CLI, the
templates it ships, `@podosoft/podokit-api-client`, etc.), add a changeset in the
same PR:

```bash
npm run changeset
```

Pick the affected package(s), choose the bump (`patch` for fixes, `minor` for
features, `major` for breaking changes — pre-1.0, use `minor`/`patch`), and write
a short user-facing summary. This creates a small file under `.changeset/` —
commit it. Skip the changeset for changes that do not affect a published package
(repo tooling, internal docs, CI). Releases are cut later by accumulating these;
see [docs/development.md](docs/development.md#releasing).

## Pull requests

1. Fork and create a feature branch (`feat/...`, `fix/...`).
2. Add or update tests for behavior changes.
3. Ensure `build`, `lint`, and `test` pass.
4. Add a changeset if a published package changed (see above).
5. Open a PR using the template and describe the change and rationale.

## AI-assisted contributions

AI-generated contributions are welcome if you review them before submission. Do not submit code you do not understand.
