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

## Pull requests

1. Fork and create a feature branch (`feat/...`, `fix/...`).
2. Add or update tests for behavior changes.
3. Ensure `build`, `lint`, and `test` pass.
4. Open a PR using the template and describe the change and rationale.

## AI-assisted contributions

AI-generated contributions are welcome if you review them before submission. Do not submit code you do not understand.
