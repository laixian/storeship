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
| `shots check\|render\|upload\|seed` | App Store screenshots (see below) |
| `sim …` | simulator driver (see below) |
| `preview record\|stop\|cut\|check\|upload` | App Preview video (see below) |
| `reel card\|pts\|make` | vertical social video (see below) |
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

## Screenshots

Real simulator screenshots + a template + a content file → exact-size PNGs for every device × locale, validated, with a contact sheet, uploaded by display type.

```bash
storeship shots check                # every problem at once: numbering, titles, sources, crops
storeship shots render --sheet       # PNGs into shots.out + a contact sheet per device × locale
storeship shots upload 1.4.0         # into the right ASC set per device; only new files (--replace to wipe)
storeship shots seed -- --locale en  # run your demo-data script (shots.seed), args passed through
```

Config:

```json
"shots": {
  "src": "store/screenshots",          "out": "store/shots",
  "content": "store/shots/content.ts", "template": "store/shots/template.ts",
  "devices": ["iphone69", "ipad13"],   "localeTags": { "zh-Hans": "zh", "en-US": "en" },
  "seed": "store/shots/seed.ts"
}
```

Source files are named `<prefix>-<localeTag>-<n>-<slug>.png` (`iphone-en-1-home.png`; a second screen for the same frame: `1b-<slug>`). Built-in devices: `iphone69` (1320×2868, APP_IPHONE_67), `iphone67`, `iphone63`, `iphone65`, `iphone55`, `ipad13` (2064×2752, APP_IPAD_PRO_3GEN_129), `ipad129`, `ipad11`; the content file may add or override devices.

**Content** — a module exporting `Shot[]` (or `{ shots, devices?, template? }`):

```ts
import type { Shot } from 'storeship'
export default [
  { n: 1, slug: 'home', sn: 'HOME', bg: '#2FE9DF',
    title: { 'en-US': ['One playhead', 'the whole band'], 'zh-Hans': ['自动走针', '全员同一小节'] },
    cards: { iphone69: [{ x: 70, y: 820, w: 1400, h: 1185, sx: 0, sy: 0, sw: 1560 }] } },
] satisfies Shot[]
```

`cards[device]` are rectangles on the canvas; `sx/sy/sw` is a rectangle on the source image (height follows the card's aspect), so a crop is always "zoom into a corner of the same screen". A missing device layout is an error, never a silently wrong picture.

**Template** — optional; a module exporting `{ render(ctx) => html, titleLines?, titleMax?, snPattern? }`. `ctx` has `shot`, `locale`, `device`, `total`, `title` (the lines for this locale) and `cards` (each with a data-URI `img` and its native size). The built-in template is deliberately plain.

The checker refuses: wrong numbering, missing or wrong-count title lines, missing or wrong-size sources, crops out of bounds, cards bleeding on both sides (no visible corner → reads as a colour band), and layouts missing for a device. Every failure on this path is otherwise silent.

## Simulator driver

```bash
storeship sim which                       # idb or CGEvent fallback, target simulator
storeship sim statusbar                   # 9:41, full battery, full signal
storeship sim find "Play"                 # tap by accessibility label (idb)
storeship sim tap 220 284                 # device points, portrait
storeship sim ltap 330 1121               # pixels on the rotated screenshot of a landscape page
storeship sim drag 200 800 200 300
storeship sim shot out.png [270]          # 270 rotates a landscape capture upright
storeship sim ls [pattern]                # accessibility tree
```

`--profile <deviceId>` picks the simulator by the device table (`sim.profile` in config); `--udid` overrides. **idb** (`idb ui tap`) takes device points and needs no window geometry or Accessibility grant. `brew install idb-companion` fails on a machine with full Xcode only; install the prebuilt companion + pip:

```bash
curl -L -o /tmp/idbc.tar.gz https://github.com/facebook/idb/releases/download/v1.5.0.b3/idb-companion.macos-arm64.tar.gz
mkdir -p ~/.local/opt/idb && tar -xzf /tmp/idbc.tar.gz -C ~/.local/opt/idb
python3 -m venv ~/.local/opt/idb/venv && ~/.local/opt/idb/venv/bin/pip install fb-idb
```

Without idb the driver synthesizes mouse events (CGEvent) from the simulator window position; that needs Accessibility permission for your terminal and the target window raised.

## App Preview video

```bash
storeship preview record seg1.mov --device iphone69   # simctl recordVideo; stop cleanly with…
storeship preview stop                                # …SIGINT — never kill the process (leaks the session; only a reboot fixes it)
storeship preview cut out.mp4 seg1.mov:0:8:p seg2.mov:1:7 seg3.mov:1:7 --device iphone69 [--music song.wav]
storeship preview check out.mp4 --device iphone69     # size / 15–30 s / ≤30 fps / frame count
storeship preview upload 1.4.0 out.mp4 --device iphone69 --locale en-US [--replace]
```

Segments are `<file>:<start>:<duration>[:p]`; `:p` marks a portrait page (letterboxed instead of rotated — a landscape app recorded by a portrait simulator comes out sideways). The canvas is the App Preview size for the device (1920×886 for iPhone, 1200×1600 for iPad; `--portrait` or `--size WxH` to override). Each segment is first rendered to a fixed-length constant-frame-rate part, then crossfaded, then faded in/out, with optional music faded under it.

Why the intermediate step: `simctl` recordings write a frame only when something changes. Crossfading them directly breaks the stream at the seam — the film has the right duration and half the frames — and `-t` on such a file often yields less than asked, so the crossfade offsets come from the durations actually produced. `preview check` flags the frame-count symptom on any file.

Needs ffmpeg: `~/.local/opt/ffmpeg/ffmpeg` (a static build), `ffmpeg` in the config, `STORESHIP_FFMPEG`, or PATH.

## Reel (vertical social video)

A simulator recording inside a designed card, for Xiaohongshu / Reels / Shorts.

```bash
storeship reel card /tmp/card.png                 # the card layer alone (PNG with a transparent hole)
storeship reel pts take.mov                       # frame timestamps; steady runs → where audio t=0 belongs
storeship reel make take.mov out.mp4 --start 3.4 --duration 20 [--audio song.wav --audio-t0 3.43]
```

Config `reel.content` points at a module/JSON exporting `{ canvas, band, crop?, rotate?, fps?, copy }`; `reel.template` optionally replaces the built-in card (label, two-line title with `<em>` accents, glow ring, bullet points, brand line — all from `copy`, colours from `copy.colors`).

- **The card is a foreground with a hole.** In a frame produced by `AVVideoCompositionCoreAnimationTool` the area outside the video is black, not transparent, so a background would be covered. The tool builds the opaque panes around the band; a template must not paint the card's background.
- **`band.h` is derived**, not chosen: the recording, rotated and cropped, scaled to `band.w`, has one height. `reel make` refuses a mismatch and prints the right number.
- **Audio is aligned by frame timestamps.** `simctl` recordings carry no app audio. If the app redraws on a beat, `reel pts` finds the steady cadence and its first frame; render the audio offline and pass that time as `--audio-t0` (recording timeline). Not the frame where play was pressed.
- Needs Xcode's toolchain (the compositor is Swift, compiled once and cached) and Chrome for the card.

## License

MIT
