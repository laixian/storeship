# storeship

Ship an Expo / React Native iOS app to the App Store **from your Mac**, in one command, with the traps already encoded — and built for an agent to drive.

```bash
npx storeship release 1.4.0 --date 2026-10-01
```

That runs: preflight (did you forget `expo prebuild`?) → `xcodebuild archive` → export IPA → `altool` upload → create the App Store version (scheduled) → write What's New for every locale → wait for the build to finish processing and attach it → submit for review. Every step is idempotent; if it dies half-way, run it again.

**Docs**: [from zero to review](docs/walkthrough.md) · [for agents](docs/agents.md) · [command reference](docs/commands.md) · [configuration](docs/config.md) · [store listing](docs/listing.md) · [subscriptions & pricing](docs/products.md) · [screenshots & video](docs/media.md) · [library use](docs/api.md)
**中文**: [README](docs/zh/README.md) · [从零到提审](docs/zh/walkthrough.md) · [给 agent 用](docs/zh/agents.md) · [命令参考](docs/zh/commands.md) · [配置参考](docs/zh/config.md)

## Why another tool

- **fastlane** does all of this and much more, in Ruby, with a Gemfile, and a `Fastfile` you have to learn.
- **EAS** does it in the cloud, for money, and silently ships without files your `.gitignore` excludes.
- The **App Store Connect CLIs** on GitHub wrap the API one endpoint per command and stop at the API.

storeship is the middle: **zero runtime dependencies** (Node ≥ 22.18 runs the TypeScript directly), a single JSON config, the whole path from `xcodebuild` to "Waiting for Review", and a table of misleading Apple error messages translated into what is actually wrong. It was extracted from a shipping app after its author had paid for every one of those lessons.

## Built for an agent to drive

Not "it has a `--json` flag". The interface an agent needs is the product:

```bash
storeship state --json     # where is this release, and what should I run next
storeship spec  --json     # every command, its impact, the exit codes, the error codes
```

- **One envelope, always the same shape** — `{ ok, command, data, changed[], warnings[], next[], error? }`. `ok` says whether the command ran; the exit code says whether the answer was yes.
- **Exit codes are a contract.** 0 ok · 2 bad command line · **3 no** (rejected, differs, over limit) · **4 pending** (still processing, still in review) · **5 a human must act** · 1 failed.
- **Stable error codes.** Apple answers a wrong key, a revoked key, a DER signature and a skewed clock with the same bare 401. storeship answers `AUTH`, with the real cause in `hint` — and `XCODE_NO_ACCOUNT`, `BUILD_NOT_PROCESSED`, `VERSION_NOT_EDITABLE`, `CLOUD_SIGNING` for the other messages that point the wrong way. Branch on the code, never the prose.
- **Impact is data, not a warning in a README.** Every command declares `read` / `write` / `irreversible` and which decisions are the human's. The CLI refuses an irreversible command without `--yes`, and `state` never suggests one.
- **`--dry-run` on everything that writes**, returning the same change set the real run reports.
- **Skills that cannot drift.** `storeship init` installs five Claude Code skills and the permission rule; the facts inside them are generated from the code and CI fails if a skill names a command that no longer exists.

The whole contract, and how to wire an agent to it: **[docs/agents.md](docs/agents.md)**.

## Requirements

- macOS with Xcode (for `ship`); the App Store Connect commands run anywhere Node runs
- Node ≥ 22.18
- An App Store Connect API key (App Manager role is enough for releasing; Admin for analytics)

## Install

```bash
npm i -D storeship            # in the project — recommended, pinned in package.json
npm i -g storeship            # or globally
npx storeship@latest doctor   # or not at all
```

The npm package is the compiled build. To run from source (to change the tool itself): `git clone https://github.com/laixian/storeship && cd storeship && pnpm install && pnpm build && node dist/cli.js …`.

## Configure

```bash
npx storeship init            # config from expo config + ASC, plus the agent skills and permission rule
npx storeship doctor          # every prerequisite, with the fix for each miss
npx storeship state           # where the release is, and what to run next
```

Put the private key where Apple's own `altool` also looks:

```
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8     (chmod 600)
```

The key id, issuer id, app id and team id are identifiers, not secrets; they go in the config file. Environment variables override the file: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, `ASC_APP_ID`, `ASC_TEAM_ID`. The demo-account password is never in a file: `ASC_DEMO_PASSWORD`.

```json
{
  "app": { "id": "1234567890", "bundleId": "com.example.app" },
  "asc": { "keyId": "ABC123DEF4", "issuerId": "00000000-0000-0000-0000-000000000000", "teamId": "TEAM123456" },
  "locales": ["en-US", "zh-Hans"],
  "ios": { "projectDir": "apps/mobile" },
  "listing": { "file": "store/listing.md" },
  "whatsNew": { "dir": "store/whats-new" },
  "release": { "scheduledTime": "08:00:00-07:00" },
  "products": { "yearly": "1234567891" }
}
```

Relative paths resolve from the config file, so commands work from any subdirectory. `ios.workspace`, `ios.scheme` and `ios.infoPlist` are derived from `<projectDir>/ios` unless set. A `.ts` / `.mjs` config file exporting the same object also works. Every key: [configuration](docs/config.md).

## Commands

Every command takes `--json`, and every flag is in the [command reference](docs/commands.md) and in `storeship <command> --help`.

| Command | What it does |
|---|---|
| `init` | write the config, install the agent skills and the permission rule |
| `doctor` | check Node, Xcode, key file, permissions, project, and that the key actually works |
| `state` | where the release is and what to run next, in one call |
| `spec` | the machine-readable interface: impact, exit codes, error codes |
| `ship [--skip-upload]` | preflight → archive → export → upload |
| `export <archive>`, `upload <ipa>` | the resume points when one of those steps failed |
| `release <ver> [--date D] [--dry-run] [--yes]` | the whole thing, with a printed plan and a confirmation |
| `version status\|create\|whatsnew\|attach\|submit\|watch\|cancel` | the version record, from creation to a review verdict |
| `builds` | recent builds and processing state |
| `listing check\|diff\|push` | store metadata and App Review information from one Markdown file → [docs](docs/listing.md) |
| `products check\|status\|diff\|push\|pricepoints\|delete` | subscriptions, prices, availability → [docs](docs/products.md) |
| `offer list\|new\|csv\|off` | subscription offer codes (there is no UI for these) |
| `media status\|upload\|mkset\|list\|delete` | screenshots / previews per locale × device slot |
| `shots`, `sim`, `preview`, `reel` | screenshots, the simulator driver, App Preview video, social video → [docs](docs/media.md) |
| `analytics request\|list\|fetch\|sales` | Analytics Reports API and daily sales |
| `device add`, `apps` | register a device; list the account's apps |
| `skill list\|install\|check\|sync` | the agent skills |

## What it knows that you would otherwise learn the hard way

| You see | It tells you |
|---|---|
| `No signing certificate "iOS Distribution" found` on export | xcodebuild went cloud-signing because `-authenticationKey*` was passed. storeship never passes it; Xcode creates the certificate at export time. Export without the key, upload with the key. |
| `401 NOT_AUTHORIZED` | wrong ids, revoked key, wrong .p8, DER signature (it signs raw R‖S), or clock skew |
| `The specified pre-release build could not be added` | the build is still processing, or an older one was picked because the new one is not listed yet; name it with `--build N --wait` |
| `409` writing name / subtitle | you hit the locked live appInfo; there are two |
| `ICP_NUMBER_MIIT_PROVIDER_NAME_MISMATCH` | China ICP filing name ≠ developer name; not fixable via API |
| `The API key in use does not allow this request` | key role too low (Admin for analytics) |
| Offer code creation 409 ×175 | free offers must list territories but no price points; copied from the price table for you |
| Grey screenshot tile | wrong checksum; it commits the MD5 |
| `No Accounts` after a seven-minute archive | Xcode is signed out. `doctor` says so beforehand, and the archive is still good: resume with `--archive`. |

Each of these is an entry in `src/hints.ts` with an error code, and each one was chased in the wrong direction at least once.

## What it will not do

- **Pick the version number.** Edit `app.config` (`version` and `ios.buildNumber`) and run `expo prebuild`; `ship` refuses when `ios/` disagrees with `app.config`.
- **Verify the UI.** Screenshot and preview generation are separate commands and are not in the release path.
- **Cancel a submission, delete a subscription, or kill an offer on its own.** Those need `--yes`, because cancelling forfeits the queue position and issued offer codes stop working the moment you deactivate them.
- **Create the app record.** The API has no endpoint for it: five minutes on the website, then `storeship init`.
- **Android.** There is nothing here to build on; doing only iOS beats doing half of both.

## License

MIT
