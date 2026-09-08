# storeship for agents

<!-- storeship 0.3.0 — generated blocks below are written by `storeship skill sync`; do not edit them by hand -->

This page is for the person wiring an agent up to storeship. The agent itself does not need it: everything below is reachable at run time from `storeship spec --json`, `storeship state --json` and the `error` object of any command. That is the rule the tool is built on —

> **anything an agent needs at run time comes from a command it can run, not from a document it must have read first.**

Markdown is for people deciding how to use the tool. Agents read the protocol.

## The two commands to know

```bash
storeship state --json     # where is this release, what runs next
storeship spec  --json     # every command, its impact, the exit codes, the error codes
```

`state` is the loop condition. It reads the config, the project on disk (`expo config`, so it catches a forgotten `prebuild`), the version and build in App Store Connect, and how the listing file compares with what is live; then it names a `stage` and a `next` list. An agent that crashed, was resumed a day later, or arrived with a fresh context window calls it once and knows what to do.

```json
{
  "stage": "build-attached",
  "local": { "version": "1.4.0", "build": "42", "problems": [] },
  "version": { "version": "1.4.0", "state": "PREPARE_FOR_SUBMISSION", "build": { "version": "42" } },
  "clean": { "listing": false, "review": true, "whatsNew": true, "products": null },
  "differing": ["listing: zh-Hans/description"],
  "blockers": [],
  "next": [{ "command": "storeship listing diff 1.4.0", "why": "…", "impact": "read" }]
}
```

The stages are `no-config`, `not-configured`, `no-version`, `no-build`, `build-processing`, `build-ready`, `build-attached`, `submitted`, `rejected`, `approved`, `live`. `--offline` skips App Store Connect; `--deep` also diffs `products.md`, which costs many more requests.

`spec` is the command tree with each command's `impact` (`read` / `write` / `irreversible`), what it `needs` (credentials, xcode, chrome, ffmpeg, idb, simulator), which decisions are the human's (`humanDecisions`), and every flag typed as `boolean` or `value`. `storeship <command> --help --json` returns the same object for one command.

## The envelope

<!-- storeship:protocol -->
Every command takes `--json` and answers with one envelope:

```json
{ "ok": true, "command": "version attach", "data": {}, "changed": [], "warnings": [], "next": [{ "command": "…", "why": "…", "impact": "write" }] }
{ "ok": false, "error": { "code": "BUILD_NOT_PROCESSED", "message": "…", "hint": "…", "retry": "after-wait", "humanAction": null } }
```

`ok` says whether the command ran, never whether the answer was yes. The exit code says that:

| exit | meaning | what to do |
|---|---|---|
| 0 | the command did what it says | continue |
| 1 | the command failed | read error.code and error.retry; do not repeat a `never` |
| 2 | the command line was wrong | fix the command, never retry it unchanged |
| 3 | it ran, and the answer is negative: rejected, over limit, out of date, something differs | branch on the data; this is a result, not a failure |
| 4 | no verdict yet: still processing, still in review, still building | wait and ask again; the answer will change on its own |
| 5 | only a person can continue: a GUI action, a secret, or an irreversible step | stop and tell the human exactly what error.humanAction says |
| 130 | a person answered no at a confirmation | stop |

Branch on `error.code`, never on the message. `retry: "never"` means running it again changes nothing.
Read `next` — it is what this tool would do next, and it never contains an irreversible command.
<!-- /storeship:protocol -->

Two more fields exist on the success envelope:

- `changed` — what this run changed: `{ kind, target, what, detail }`. Under `--dry-run` it is what *would* change, and `dryRun: true` is set. It is the same shape either way, so "show the human the plan, then run it" needs no second parser.
- `warnings` — true and worth knowing, but not a reason to stop.

Two global flags shape `data`: `--raw` returns the full payload where the default is slimmed (`listing diff` sends field names and lengths, not four thousand characters of description per locale; `analytics fetch` sends the first twenty rows), and `--fields a,b` keeps only those top-level keys.

## Exit codes are the contract

The point of splitting 3, 4 and 5 out of "non-zero" is that they call for completely different behaviour, and prose cannot be branched on:

- **3 — no.** The command ran and the answer is negative: the review was rejected, the listing differs, a check found problems, `doctor` found a missing prerequisite. Do not treat it as a crash and do not retry it.
- **4 — pending.** No verdict yet: the build is still processing, the review has not decided. The answer will change on its own; wait and ask again. `version watch` and `version attach` use it.
- **5 — needs a human.** Xcode has no Apple ID signed in, the `.p8` was never downloaded, an irreversible command was called without `--yes`. `error.humanAction` is written to be handed to a person verbatim. Retrying is pointless.

## Error codes

Apple's message points the wrong way often enough that translating it is one of this tool's two reasons to exist. The translation carries a code, and the code is what to branch on:

<!-- storeship:errors -->
| code | exit | retry | what it actually is |
|---|---|---|---|
| `UNKNOWN` | 1 | never | an error this tool did not recognise; the message is raw |
| `USAGE` | 2 | never | wrong arguments or flags |
| `CONFIG` | 2 | never | the config file or an identifier it should hold is missing |
| `NEEDS_HUMAN` | 5 | never | a confirmation, a secret, or a GUI action that no flag can supply |
| `ABORTED` | 130 | never | a person answered no |
| `CHECK_FAILED` | 3 | never | an offline validation found problems; nothing was written |
| `DIFFERS` | 3 | never | the files and App Store Connect do not agree; nothing was written |
| `PREFLIGHT` | 1 | never | the project on disk is not what you asked to build (prebuild, version, bundle id) |
| `NOT_FOUND` | 1 | never | the object does not exist in App Store Connect |
| `TIMEOUT` | 4 | after-wait | gave up waiting; the thing being waited for may still arrive |
| `MISSING_TOOL` | 1 | never | something this command needs from outside is not there (Chrome, ffmpeg, idb, Xcode, a booted simulator) |
| `PENDING` | 4 | after-wait | it exists but is not ready yet; asking later gives a different answer |
| `API` | 1 | never | App Store Connect refused, and the reason is only in Apple's message |
| `AUTH` | 1 | never | Apple rejected the API key |
| `KEY_ROLE` | 1 | never | the key's role is too low for this endpoint |
| `KEY_MISSING` | 5 | never | the .p8 is not where it should be, and it can only be downloaded once |
| `ALTOOL_KEY_NOT_FOUND` | 1 | never | altool looks for the .p8 in its own four directories and found none |
| `BUILD_NOT_PROCESSED` | 4 | after-wait | the build is not VALID yet, or is not listed yet |
| `VERSION_NOT_EDITABLE` | 1 | never | the version is read-only in its current state |
| `XCODE_NO_ACCOUNT` | 5 | never | 👤 Xcode has no Apple ID signed in, so export cannot fetch the certificate |
| `CLOUD_SIGNING` | 1 | never | xcodebuild switched to cloud signing; the message names the wrong cause |
| `ICP_MISMATCH` | 5 | never | 👤 a China mainland ICP filing mismatch, fixable only outside the API |
| `PRICING_INVALID` | 1 | never | the price point or the availability behind it is not valid for that subscription |
| `ATTRIBUTE_IMMUTABLE` | 1 | never | the attribute can only be set when the object is created |
| `NODE_TS_STRIPPING` | 1 | never | Node refuses to run .ts from inside node_modules |

👤 = only a person can clear it; `error.humanAction` says what to tell them.
<!-- /storeship:errors -->

`error.retry` says what to do: `now` (transient), `after-wait` (the world has to change first), `never` (running it again produces the same failure).

## Irreversible commands

`version cancel`, `products delete`, `offer off` and `media delete` are marked `irreversible` in the spec. The CLI refuses to run them without `--yes` — not the command, the CLI, so a new one cannot forget — and `state` never puts one in `next`. `--yes` means a person accepted the specific consequence, which the refusal spells out in `error.humanAction`:

```
$ storeship version cancel --json
{ "ok": false, "error": { "code": "NEEDS_HUMAN", "message": "cancel is irreversible and needs --yes",
  "humanAction": "cancelling forfeits the review queue position, and whether a re-submit is accepted is only known at re-submit time…" } }
```

Commands that merely write (`listing push`, `products push`, `release`) take `--dry-run` instead: same change set, nothing touched.

Set `STORESHIP_NON_INTERACTIVE=1` when no one can answer a prompt. A confirmation then fails with `NEEDS_HUMAN` and exit 5 rather than blocking on a terminal that will never reply.

## Permissions

`release` bundles `xcodebuild`, an `altool` upload and several App Store Connect writes into one command line, and a permission classifier will often refuse that while allowing each step separately. `storeship init` writes the rules into `.claude/settings.local.json` (skip with `--no-permissions`):

```json
{ "permissions": { "allow": ["Bash(storeship *)", "Bash(npx storeship *)", "Bash(pnpm storeship *)"] } }
```

If the release half is refused anyway, run it as two commands — `storeship ship`, then `storeship release <version> --no-ship` — so a refusal on the build does not take the App Store Connect writes down with it.

## Skills

`storeship init` also copies the five Claude Code skills into `.claude/skills/` (skip with `--no-skills`; `storeship skill install` does it on its own). They hold the *procedure and the judgement* — which decisions are the human's, what to do after a rejection, how to write a title — while the *facts* in them (this protocol, the error table) are generated blocks and every command they name is checked to exist:

```bash
storeship skill check --dir .claude/skills   # is this copy stale? exit 3 if so
storeship skill install                      # refresh it after upgrading storeship
```

`storeship doctor` reports a stale copy as `agent skills (optional)`.

## What is deliberately not here

- **No MCP server.** Twenty-odd commands would become twenty-odd tool schemas in every context window, for no capability the CLI plus `--json` does not already give. If a host ever needs one, three tools would do: `spec`, `state`, `run`.
- **No autonomous judgement.** The tool will not pick a version number, write What's New, decide a price, or cancel a submission. Those are marked `humanDecisions` in the spec so an agent can see the boundary rather than infer it.
- **No UI verification in the release path.** A release command that fails on a screenshot diff is a release command nobody dares to run. `shots` and `preview` are separate.

## Library

Everything the CLI calls is exported from the package, including the contract itself — `EXIT`, `CODES`, `fullSpec`, `HINTS` — so a wrapper can speak the same protocol without shelling out. See [library use](api.md).
