---
name: storeship-release
description: Release an iOS app to the App Store with the storeship CLI — build, upload, version record, What's New, attach build, submit. Use when asked to ship, release, submit, or push a version to App Store Connect, or to fix store metadata.
---

# Releasing with storeship

You drive `storeship` (run as `npx storeship …`, or `pnpm storeship …` in a pnpm repo). Always add `--json` and read the structure; never scrape the human output. Errors come back as `{ "error", "hint" }` — the hint is the real cause, act on it before retrying.

## Before anything

1. `storeship doctor --json`. Fix every non-optional ✗ first; the `fix` field says how.
2. `storeship version status --json`. Know which versions exist and their state. A version in `WAITING_FOR_REVIEW` / `IN_REVIEW` is read-only.

## Things that are the human's call — ask, do not decide

- **The version number and build number.** They live in `app.config.*` (`version`, `ios.buildNumber`); after editing, `npx expo prebuild` must run. `storeship ship` refuses when `ios/` disagrees with `app.config`. Do not "fix" that by editing `Info.plist`.
- **The release date** (`--date YYYY-MM-DD` makes it scheduled; none means manual release after approval).
- **What's New text.** Draft it if asked, from the git log since the last tag, but show it before writing it. Files go to `<whatsNew.dir>/<version>/<locale>.txt`, one per configured locale.
- **Cancelling a submission.** Never run `version cancel` on your own initiative. It forfeits the review queue position, and a re-submit can be blocked by account-level checks that only appear at submit time.

## The normal path: two commands, not one

```bash
storeship ship --json                                   # preflight → archive → export → upload
storeship release <version> --date <YYYY-MM-DD> --no-ship --yes --json   # create → What's New → attach → submit
```

`release` alone does all of it, but run it as two steps: the first is the slow, local, high-impact one (xcodebuild + an upload), the second is a handful of App Store Connect writes. If the harness you run in denies one big command, it usually allows the halves — and if `ship` is denied, hand exactly that command to the human and continue with the second half yourself once the build is up.

Every step is idempotent: on failure, read the hint, fix, and run the same command again. Resume points:

- Archive succeeded, export or upload failed → `storeship release <version> --archive <path.xcarchive> …` (or `storeship export <path.xcarchive>` then `storeship upload <ipa>`). Do not archive again; it takes minutes.
- Build uploaded some other way (Xcode Organizer, CI) → `--no-ship`, and name it: `--build <N>`.
- `--no-submit` stops before review; `storeship version submit <version>` later.

Permission rules the human can add so none of this prompts (Claude Code, `.claude/settings.local.json`):

```json
{ "permissions": { "allow": ["Bash(pnpm storeship *)", "Bash(npx storeship *)"] } }
```

## Store metadata

- `storeship listing check` — offline; parse and limits.
- `storeship listing diff <version> --json` — what differs from App Store Connect. Show the human the diff.
- `storeship listing push <version>` — only after the human agrees. Name/subtitle need a version in preparation; a `409` there means the locked live appInfo was hit.
- App Review information (notes, contact, demo account) is the `## review` section of the same file and rides on the same diff/push. When drafting review notes, write how a reviewer reaches every feature on one device, what each permission is for, and where the paywall is — most rejections come from this field. The demo password is `ASC_DEMO_PASSWORD` in the environment; never put it in the file.
- Subscriptions, prices and offer codes are a different job with its own skill: `storeship-products`. A new subscription does ride along with this release, though — it is submitted together with the app version, so check `storeship products status` before submitting if one was just created.
- Screenshots and previews are inherited from the previous version. Only upload what changed: `storeship media status <version> --json` for the set ids, then `storeship media upload screenshot <setId> <files…>` in display order.

## After a rejection

You do not have to keep checking. `storeship version watch <version> --json` polls until the review reaches a verdict and exits **0 approved / 3 rejected / 4 no decision yet**, so it can be left running in the background or re-run from a scheduled job — `--once` checks and returns immediately. On a rejection it names the items that were turned down, which matters when the submission carried subscriptions as well as the app.

**Apple's reason is not in the API.** Resolution Center is web-only, so you cannot read why the version was rejected — ask the human to paste Apple's message, and never guess at it. Fixing the wrong thing costs another review cycle.

`storeship version status --json` first. A version Apple rejected is **already editable**: do not run `version cancel` on it. Cancel is only for a version still sitting in the queue.

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

## Reading failures

- `preflight` errors: prebuild forgotten, or the version you asked for is not what `ios/` contains.
- Export failing with `No Accounts`: Xcode has no Apple ID signed in. That is a GUI action (Xcode → Settings → Accounts) — ask the human, then resume with `--archive`. `doctor` reports it as `Xcode account` before you spend minutes archiving.
- Export failing with "No signing certificate iOS Distribution" **without** `No Accounts`: do **not** go looking for certificates; the hint explains cloud signing. If you ran `xcodebuild` by hand, remove the `-authenticationKey*` flags.
- `attach` 409 "pre-release build could not be added": either the build is still processing, or an older build was picked because the new one is not listed yet. Name it: `storeship version attach <version> --build <N> --wait`. Never re-upload.
- `submit` failing with `STATE_ERROR`: read `associatedErrors` in the message; it is often an account-level issue (e.g. ICP filing in China) that no command can fix.

## Never

- Never edit `Info.plist`, `ExportOptions.plist`, or provisioning by hand to get past an error.
- Never pass the API key to `xcodebuild`.
- Never run `version cancel`, `media delete`, or `offer off` without an explicit instruction naming the target.
