# Working on storeship itself

For an agent (or a person) changing this repository. How to *use* the tool from an agent is a different document: [docs/agents.md](docs/agents.md).

## The rule everything follows

**Anything an agent needs at run time comes from a command it can run, not from a document it must have read first.** Prose is for people choosing a tool; `spec`, `state` and `error.code` are for agents using it. When you add something an agent must know, ask which of the two it is — and if it is the second, it belongs in the command tree or in `src/codes.ts`, not only in a README.

## Layout

```
src/cli.ts          parse / dispatch / enforce the irreversible rule / render the envelope — only these
src/codes.ts        exit codes and error codes: the published contract
src/errors.ts       StoreshipError (code, hint, retry, humanAction) and its four subclasses
src/hints.ts        error text → real cause + code. Every entry really happened
src/out.ts          the JSON envelope, --raw / --fields projection, table helpers
src/spec.ts         the command tree as data (`storeship spec`)
src/commands/*      one file per command: read args, call the layers below, print. The tree is defined here
src/commands/state.ts  the "where am I / what next" command — the loop condition for an agent
src/asc/*           pure App Store Connect operations: functions take a client and ids, touch no argv/console
src/ios/xcode.ts    xcodebuild / altool / expo config / PlistBuddy
src/shots|sim|preview|reel   screenshots, the simulator driver, App Preview video, social video
src/skills/sync.ts  generated blocks and drift checks for skills and agent docs
skills/*            the procedures an agent loads (Claude Code SKILL.md)
```

`src/asc/*` is the library surface (all of it is re-exported from `src/index.ts`); command files are thin shells over it. Tests target that layer and the pure functions.

## When you add or change a command

1. Give it `impact` (`read` / `write` / `irreversible`), `needs`, and `humanDecisions` when a decision is not the tool's to make. A test fails if a leaf command has no explicit `impact`.
2. `irreversible` also needs `confirm` — one sentence saying what `--yes` accepts — and a documented `yes` flag. The CLI does the refusing; do not hand-roll a `--yes` check.
3. Anything that writes should take `--dry-run` and report the same `changed[]` it would produce for real.
4. Report results with `ctx.out.emit(slim, full?)`, changes with `ctx.out.changed(...)`, and what to do next with `ctx.out.next(...)`. Never `console.log` a result — progress goes to `ctx.out.note` (stderr), results to the envelope.
5. Add every flag to `flags` *and* to `usage` (a test checks), and a Chinese `summary` / `flags` entry in `src/docs/zh.ts` (another test checks).
6. Regenerate everything derived: **`pnpm gen`** (the command reference in both languages, and the generated blocks in the skills and agent docs). `pnpm check` is what CI runs.

## When you add an error

A new failure mode gets a code in `src/codes.ts` (with its exit status and `retry`), not a bare `StoreshipError`. If Apple's wording for it points the wrong way, add the pattern to `src/hints.ts` — the bar for an entry is that it really happened here and really misled someone. `humanAction` is only for things no command can fix (a GUI action, a secret Apple hands out once).

Exit statuses mean: 3 the answer is no, 4 not yet, 5 a person must act. Reaching for 1 usually means one of those three was the honest answer.

## Checks

```bash
pnpm check                            # typecheck + tests + every generated file is current
pnpm gen                              # regenerate those files after changing a command
pnpm build && node dist/cli.js --help # the published shape actually runs
```

`pnpm check` is `typecheck` + `test` + `docs --check` (both languages) + `skill sync --check` + `skill check`. CI runs all of it on macOS, against `dist/`.

CI runs all of them on macOS. `erasableSyntaxOnly` is on: no constructor parameter properties, no `enum`, no `namespace` — Node strips types, it does not transform.

## Things that will bite you

- **Publishing needs `dist/`.** Node refuses to strip types from `.ts` inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so `bin` points at `dist/cli.js`. Running from source works only because a pnpm link resolves outside `node_modules`.
- **The envelope is versioned.** `PROTOCOL` in `src/meta.ts` is bumped when a reader would break; adding a field is not a break, changing one is.
- **Every relative path in the config resolves from the config file**, never from cwd. Commands must work from any subdirectory.
- **Writes to App Store Connect are barely testable offline.** Unit tests use a fake `fetch`; anything about *time* (a build takes minutes to appear, an Xcode session expires) has only ever been caught by a real release. Say so in the commit rather than implying coverage.
