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

## The normal path

```bash
storeship release <version> --date <YYYY-MM-DD> --yes --json
```

This does preflight → archive → export → upload → create version → What's New → attach (waits for the build to be VALID, usually 5–20 minutes) → submit. Each step is idempotent: on failure, read the hint, fix, and run the same command again. `--no-submit` stops before review; `--no-ship` skips the build when the IPA is already uploaded.

If the build was uploaded some other way (Xcode Organizer, CI), use `--no-ship`.

## Store metadata

- `storeship listing check` — offline; parse and limits.
- `storeship listing diff <version> --json` — what differs from App Store Connect. Show the human the diff.
- `storeship listing push <version>` — only after the human agrees. Name/subtitle need a version in preparation; a `409` there means the locked live appInfo was hit.
- Screenshots and previews are inherited from the previous version. Only upload what changed: `storeship media status <version> --json` for the set ids, then `storeship media upload screenshot <setId> <files…>` in display order.

## Reading failures

- `preflight` errors: prebuild forgotten, or the version you asked for is not what `ios/` contains.
- Export failing with "No signing certificate iOS Distribution": do **not** go looking for certificates; the hint explains cloud signing. If you ran `xcodebuild` by hand, remove the `-authenticationKey*` flags.
- `attach` not VALID: wait, do not re-upload.
- `submit` failing with `STATE_ERROR`: read `associatedErrors` in the message; it is often an account-level issue (e.g. ICP filing in China) that no command can fix.

## Never

- Never edit `Info.plist`, `ExportOptions.plist`, or provisioning by hand to get past an error.
- Never pass the API key to `xcodebuild`.
- Never run `version cancel`, `media delete`, or `offer off` without an explicit instruction naming the target.
