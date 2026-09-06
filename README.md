# storeship

Ship an Expo / React Native iOS app to the App Store **from your Mac**, in one command, with the traps already encoded.

```bash
npx storeship release 1.4.0 --date 2026-10-01
```

That runs: preflight (did you forget `expo prebuild`?) → `xcodebuild archive` → export IPA → `altool` upload → create the App Store version (scheduled) → write What's New for every locale → wait for the build to finish processing and attach it → submit for review. Every step is idempotent; if it dies half-way, run it again.

## Why another tool

- **fastlane** does all of this and much more, in Ruby, with a Gemfile, and a `Fastfile` you have to learn.
- **EAS** does it in the cloud, for money, and silently ships without files your `.gitignore` excludes.
- The **App Store Connect CLIs** on GitHub wrap the API one endpoint per command and stop at the API.

storeship is the middle: **zero runtime dependencies** (Node ≥ 22.18 runs the TypeScript directly), a single JSON config, the whole path from `xcodebuild` to "Waiting for Review", and a table of misleading Apple error messages translated into what is actually wrong. It was extracted from a shipping app after its author had paid for every one of those lessons.

## Requirements

- macOS with Xcode (for `ship`); the App Store Connect commands run anywhere Node runs
- Node ≥ 22.18
- An App Store Connect API key (App Manager role is enough for releasing; Admin for analytics)

## Setup

```bash
npm i -D storeship            # or: pnpm add -D storeship
npx storeship init            # writes storeship.config.json from expo config + ASC
npx storeship doctor          # every prerequisite, with the fix for each miss
```

Put the private key where Apple's own `altool` also looks:

```
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8     (chmod 600)
```

The key id, issuer id, app id and team id are identifiers, not secrets; they go in the config file. Environment variables override the file: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, `ASC_APP_ID`, `ASC_TEAM_ID`.

### storeship.config.json

```json
{
  "app": { "id": "6802359142", "bundleId": "com.example.app" },
  "asc": { "keyId": "ABC123DEF4", "issuerId": "00000000-0000-0000-0000-000000000000", "teamId": "TEAM123456" },
  "locales": ["en-US", "zh-Hans"],
  "ios": { "projectDir": "apps/mobile" },
  "listing": { "file": "store/listing.md" },
  "whatsNew": { "dir": "store/whats-new" },
  "release": { "scheduledTime": "08:00:00-07:00" },
  "products": { "yearly": "6805831598" }
}
```

Relative paths resolve from the config file, so commands work from any subdirectory. `ios.workspace`, `ios.scheme` and `ios.infoPlist` are derived from `<projectDir>/ios` unless set. `ios.exportOptions` merges extra keys into the generated `ExportOptions.plist`. A `.ts` / `.mjs` config file exporting the same object also works.

## Commands

Every command takes `--json` for machine-readable output (progress still goes to stderr).

| Command | What it does |
|---|---|
| `init` | write the config from `expo config` and App Store Connect |
| `doctor` | check Node, Xcode, key file, permissions, project, and that the key actually works |
| `ship [--skip-upload]` | preflight → archive → export → upload |
| `upload <ipa>` | upload an existing IPA |
| `release <ver> [--date D] [--no-ship] [--no-submit] [--yes]` | the whole thing, with a printed plan and a confirmation |
| `version status` | versions with state, release type, scheduled date |
| `version create <ver> [--date D]` | create the record; with a date it is a scheduled release |
| `version whatsnew <ver> [--dir D \| --file <locale>=<path>…]` | write What's New per locale |
| `version attach <ver> [--wait]` | attach the newest build; `--wait` polls until it is VALID |
| `version submit <ver>` | submit for review |
| `version cancel --yes` | withdraw the open submission (one-way; the flag is deliberate) |
| `builds` | recent builds and processing state |
| `listing check` | parse the listing file, check character limits (offline) |
| `listing diff <ver>` | compare the file with App Store Connect, write nothing |
| `listing push <ver>` | write the differing fields |
| `media status <ver>` | screenshots / previews per locale × device slot, with set ids |
| `media upload screenshot\|preview <setId> <files…>` | chunked upload with the MD5 commit |
| `media mkset screenshot\|preview <locId> <type>` | create an empty slot |
| `media list`, `media delete` | inspect / remove items |
| `offer list\|new\|csv\|off` | subscription offer codes (there is no UI for these) |
| `device add <name> <udid>` | register a device |
| `apps` | apps in the account |
| `analytics request\|list\|fetch\|sales` | Analytics Reports API and daily sales |
| `skill list\|install` | agent skills (see below) |

## Store listing as code

`listing.md` is the source of truth for the six metadata fields. `listing diff` shows what differs; `listing push` writes only that.

```markdown
# Store listing

## en-US
### name
My App
### subtitle
Does the thing
### keywords
a,b,c
### description
```
Several paragraphs. A fenced block is taken verbatim,
so `#` and `---` inside it are safe.
```
### promotionalText
Optional.

## zh-Hans
### name
…
```

Rules: a `##` heading that looks like a locale code opens a locale; other `##` sections are prose and ignored. Field headings are the ASC attribute names. Fields you leave out are left alone in ASC. Limits are checked before anything is written (30 / 30 / 100 / 4000 / 170, CJK counts as one).

What's New lives in `<whatsNew.dir>/<version>/<locale>.txt`, or is passed with `--file en-US=path`.

## What it knows that you would otherwise learn the hard way

| You see | It tells you |
|---|---|
| `No signing certificate "iOS Distribution" found` on export | xcodebuild went cloud-signing because `-authenticationKey*` was passed. storeship never passes it; Xcode creates the certificate at export time. Export without the key, upload with the key. |
| `401 NOT_AUTHORIZED` | wrong ids, revoked key, wrong .p8, DER signature (it signs raw R‖S), or clock skew |
| `The specified pre-release build could not be added` | the build is still processing; use `attach --wait` |
| `409` writing name / subtitle | you hit the locked live appInfo; there are two |
| `ICP_NUMBER_MIIT_PROVIDER_NAME_MISMATCH` | China ICP filing name ≠ developer name; not fixable via API |
| `The API key in use does not allow this request` | key role too low (Admin for analytics) |
| Offer code creation 409 ×175 | free offers must list territories but no price points; copied from the price table for you |
| Grey screenshot tile | wrong checksum; it commits the MD5 |

## What it will not do

- **Pick the version number.** Edit `app.config` (`version` and `ios.buildNumber`) and run `expo prebuild`; `ship` refuses when `ios/` disagrees with `app.config`.
- **Verify the UI.** A release tool that fails on a screenshot diff is a release tool nobody dares to run. Screenshot and preview generation are separate commands (coming) and are not in the release path.
- **Cancel a submission on its own.** `cancel` needs `--yes`, because cancelling forfeits the queue position and whether a re-submit is accepted is only known when you try.

## For agents

`--json` on every command. `storeship skill install` copies Claude Code skills into `.claude/skills/`: the release runbook as a procedure, with the judgement calls (version number, whether to cancel, what to write) left to the human.

## Roadmap

- `shots`: App Store screenshot compositor — real simulator screenshots + an HTML template + a content file → exact-size PNGs for every device × locale, with a checker (every failure on this path is silent) and a contact sheet.
- `preview`: cut a preview video from simulator recordings (VFR-aware; `xfade` on raw `simctl` recordings drops half the frames).
- `reel`: vertical social video (card overlay + offline audio aligned by frame timestamps).

## License

MIT
