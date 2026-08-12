# Contributing to Porcupine

Thanks for being here! 🦔 Whether you're fixing a bug, adding a feature, or
just asking a question — contributions are welcome.

## The short version

1. Open a contribution proposal for anything non-trivial before writing code.
2. Keep changes focused: one logical change per PR.
3. Run the checks locally before opening the PR.
4. Be kind. That's it.

## Where things live

The product code lives in the `Porcupine/` folder (a monorepo):

```text
Porcupine/
├── packages/
│   ├── coding-agent/   # the CLI, TUI, tools, skills, docs
│   ├── agent/          # agent runtime core (pi-agent-core)
│   ├── ai/             # model runtimes and catalogs
│   ├── tui/            # terminal UI toolkit
│   └── ...
├── scripts/
└── ...
```

The repository root holds the project-level files: `README.md`, `LICENSE`,
`CONTRIBUTING.md`, `SECURITY.md`, and the GitHub workflows in `.github/`.

## Setting up a development environment

```bash
git clone https://github.com/Abd0r/porcupineai.git
cd porcupine
cd Porcupine
npm install --ignore-scripts
npm run build

cd packages/coding-agent
npm link        # makes `porcupine` available on your PATH
cd ../..
```

Without linking, run `node Porcupine/packages/coding-agent/dist/cli.js` from
the repository root.

## Making a change

A good PR is small and honest:

- **Describe what you changed and why.** The PR body should explain the
  problem and your approach — future-you will thank you.
- **One logical change per PR.** If you notice something unrelated, mention it
  in a separate PR or issue instead of bundling it in.
- **Tests for behavior changes.** If you change how something works, add or
  update a test. Time-dependent tests should use the real clock — no hardcoded
  dates.
- **Update docs when user-facing behavior changes** (under
  `Porcupine/packages/coding-agent/docs/`).

Using an AI agent to help is totally fine — just make sure you understand the
code you're submitting.

## Running the checks

```bash
npm run check        # typecheck and lint
npm test             # test suite (or a targeted test file)
```

For a focused change, run only the affected tests:

```bash
npx vitest --run packages/coding-agent/test/<affected-file>.test.ts
```

## Commit messages

Conventional commits are appreciated: `feat(scope): ...`, `fix(scope): ...`,
`docs: ...`, `test(scope): ...`, `chore(scope): ...`. One logical change per
commit. The `CHANGELOG.md` is maintained by the maintainer — no need to edit it.

## Labels and triage

Issues and PRs use a small structured taxonomy:

| Group | Purpose | Examples |
|---|---|---|
| Work type | What kind of change it is | `bug`, `enhancement`, `documentation`, `performance`, `security`, `tests` |
| Area | Which product surface owns it | `area/agent`, `area/tui`, `area/safety`, `area/mcp`, `area/browser-webdev` |
| Status | What needs to happen next | `status/needs-triage`, `status/needs-reproduction`, `status/blocked`, `status/ready` |
| Priority | Maintainer scheduling and impact | `priority/critical`, `priority/high`, `priority/medium`, `priority/low` |
| Platform | Only when platform-specific | `platform/macos`, `platform/linux`, `platform/windows` |

Maintainers apply and update labels during triage. Priority labels express impact and scheduling, not contributor importance.

## PR checklist

- [ ] The change does what the PR says
- [ ] `npm run check` passes
- [ ] Tests pass (targeted is fine)
- [ ] Docs updated for user-facing changes
- [ ] No secrets or personal paths (`.pi/`, `Project/`, `.env`) in the diff

## Reporting bugs

Open an issue with the bug template — include what you expected, what
happened, and how to reproduce. Short and concrete issues are the easiest to
fix.

## Security

See [SECURITY.md](SECURITY.md). For vulnerabilities, open an issue (mark it
security-related) and avoid including credentials or tokens in the report.

## Questions?

Open an issue using the most relevant template. No question is too basic; Porcupine
is a friendly project.
