---
name: storeship-release
description: Release an iOS app to the App Store with the storeship CLI — build, upload, version record, What's New, attach build, submit, watch the review. Use when asked to ship, release, submit, or push a version to App Store Connect, or to fix store metadata after a rejection.
---

# Releasing with storeship

<!-- storeship 0.3.0 — generated blocks below are written by `storeship skill sync`; do not edit them by hand -->

You drive `storeship` (run as `npx storeship …`, or `pnpm storeship …` in a pnpm repo).

## Start here, every time

```bash
storeship state --json
```

It answers "where is this release and what runs next" in one call: the stage, what the project on disk says, the version and its state in App Store Connect, whether the build is attached, what differs from the listing file, what is blocking, and a `next` list. **Run it first, run it again after every step, and do what `next` says.** That is the whole loop; the rest of this file is the judgement `state` cannot make for you.

`storeship spec --json` is the full command tree with each command's impact and prerequisites. You never have to guess whether a command writes.

## How you talk to this tool

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

## What is the human's call — ask, do not decide

`storeship spec --json` marks these per command (`humanDecisions`). The ones that come up every release:

- **The version and build number.** They live in `app.config.*` (`version`, `ios.buildNumber`); after editing, `npx expo prebuild` must run. `ship` refuses when `ios/` disagrees with `app.config` (`PREFLIGHT`). Never "fix" that by editing `Info.plist`.
- **The release date.** `--date YYYY-MM-DD` schedules it; without one the release is manual after approval.
- **What's New.** Draft it if asked, from the git log since the last tag, but show it before writing it. Files go to `<whatsNew.dir>/<version>/<locale>.txt`, one per configured locale; `version whatsnew <v> --dry-run` prints exactly what would be written.
- **Anything marked irreversible.** `version cancel`, `products delete`, `offer off`, `media delete` refuse to run without `--yes`, and `state` never suggests them. Do not pass `--yes` to one of these unless the human named that exact action.

## The normal path: two commands, not one

```bash
storeship ship --json                                                    # preflight → archive → export → upload
storeship release <version> --date <YYYY-MM-DD> --no-ship --yes --json   # create → What's New → attach → submit
```

`release` alone does all of it, but running it as two steps keeps the slow local half (xcodebuild + an upload, minutes) apart from the App Store Connect half (a handful of writes). If a permission prompt denies the first, hand exactly that command to the human and carry on with the second yourself once the build is up.

Before running the real thing: `storeship release <version> --date <D> --dry-run --json` returns the plan as data. Show it, then run with `--yes`.

Every step is idempotent: on failure, read `error.hint`, fix, run the same command again. Resume points:

- Archive succeeded, export or upload failed → `storeship release <version> --archive <path.xcarchive> …` (or `storeship export <path.xcarchive>` then `storeship upload <ipa>`). Do not archive again; it takes minutes.
- Build uploaded another way (Xcode Organizer, CI) → `--no-ship`, and name it: `--build <N>`.
- `--no-submit` stops before review; `storeship version submit <version>` later.

If the tool prompts for permission on every call, `storeship init` already wrote the allow rules into `.claude/settings.local.json`; if that file was not written, the rules are `Bash(storeship *)`, `Bash(npx storeship *)`, `Bash(pnpm storeship *)`.

## Store metadata

- `storeship listing check` — offline; parse and character limits. Exit 3 means over limit.
- `storeship listing diff <version> --json` — what differs from App Store Connect. **Exit 3 means something differs** — that is an answer, not a failure. Show the human the diff. Add `--raw` if you need the texts themselves rather than the field names and lengths.
- `storeship listing push <version>` — only after the human agrees. Name/subtitle need a version in preparation; a 409 there means the locked live appInfo was hit.
- App Review information (notes, contact, demo account) is the `## review` section of the same file and rides on the same diff/push. When drafting review notes, write how a reviewer reaches every feature on one device, what each permission is for, and where the paywall is — most rejections come from this field. The demo password is `ASC_DEMO_PASSWORD` in the environment; never put it in the file.
- Subscriptions, prices and offer codes are a different job with its own skill: `storeship-products`. A new subscription does ride along with this release — it is submitted together with the app version, so check `storeship products status` before submitting if one was just created.
- Screenshots and previews are inherited from the previous version. Only upload what changed: `storeship media status <version> --json` for the set ids, then `storeship media upload screenshot <setId> <files…>` in display order.

## Waiting, without babysitting

`storeship version watch <version> --json` polls until the review reaches a verdict: **exit 0 approved, 3 rejected, 4 no decision yet**. `--once` checks and returns immediately. Leave it running in the background or re-run it from a scheduled job; it backs off on 429 and 5xx instead of giving up.

## After a rejection

**Apple's reason is not in the API.** Resolution Center is web-only, so you cannot read why the version was rejected — ask the human to paste Apple's message, and never guess at it. Fixing the wrong thing costs another review cycle.

A version Apple rejected is **already editable**: do not run `version cancel` on it. Cancel is only for a version still sitting in the queue.

Most rejections, and nearly all first-submission ones, are metadata rather than binary. If nothing about the app itself has to change:

```bash
# edit the ## review notes (and whatever else Apple named) in the listing file
storeship listing check
storeship listing diff <version> --json
storeship listing push <version>
storeship version submit <version>
```

**No new build, no buildNumber bump, no re-upload.** Say that to the human — rebuilding is the reflex, and it wastes half an hour.

Only when Apple requires a change to the app itself: bump `version` / `ios.buildNumber`, `npx expo prebuild`, then `storeship release <version> --no-submit`, check, and submit.

Three causes worth checking before resubmitting, all of them fixed in files this tool owns:

- **The reviewer could not reach or verify a feature.** The `## review` notes have to walk one device from launch to the feature, in order, naming what is tapped. If anything needs an account, `demoAccountName` plus `ASC_DEMO_PASSWORD`.
- **A permission was not explained.** Say what each one is for, and what still works if it is declined — a reviewer who denies a permission and hits a dead end rejects.
- **A subscription's paywall or description is incomplete.** Price, period, what it unlocks, and links to a EULA and a privacy policy, in the store description as well as on the paywall. `storeship products status` shows whether the subscription's own metadata and review screenshot are in place.

## Error codes

Branch on `error.code`, never on the message — Apple's wording points the wrong way often enough that the whole table below exists for it.

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

Two that cost the most time when misread:

- `XCODE_NO_ACCOUNT` — Xcode has no Apple ID signed in. The archive is fine; signing in is a GUI action, then resume with `--archive <path.xcarchive>`. `storeship doctor` reports it before you spend minutes archiving.
- `BUILD_NOT_PROCESSED` — the build is still processing, or an older build was picked because the new one is not listed yet. Name it: `storeship version attach <version> --build <N> --wait`. Never re-upload.

## Never

- Never edit `Info.plist`, `ExportOptions.plist`, or provisioning by hand to get past an error.
- Never pass the API key to `xcodebuild` (`CLOUD_SIGNING` is what that looks like).
- Never run an irreversible command without an explicit instruction naming the target.
- Never treat exit 3 or 4 as a crash: 3 is a negative answer, 4 is "not yet".
