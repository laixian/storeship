# Configuration reference

storeship reads one file, `storeship.config.json` (or `.ts` / `.mjs` / `.js` exporting the same object as default), found by walking up from the current directory. Every relative path resolves from the **directory of that file**, never from the shell's cwd, so commands work from any subdirectory.

Identifiers (app id, key id, issuer id, team id) are not secrets and belong in the committed file. The only secret is the `.p8` private key, which stays outside the repo.

```json
{
  "app":      { "id": "1234567890", "bundleId": "com.example.app", "name": "Example" },
  "asc":      { "keyId": "ABC123DEF4", "issuerId": "00000000-0000-0000-0000-000000000000", "teamId": "TEAM123456" },
  "locales":  ["en-US", "zh-Hans"],
  "ios":      { "projectDir": "apps/mobile" },
  "listing":  { "file": "store/listing.md" },
  "whatsNew": { "dir": "store/whats-new" },
  "release":  { "scheduledTime": "08:00:00-07:00" },
  "products": { "monthly": "1234567891", "yearly": "1234567892" },
  "shots":    { "src": "store/screenshots", "out": "store/shots", "content": "store/shots/content.ts",
                "template": "store/shots/template.ts", "devices": ["iphone69", "ipad13"],
                "localeTags": { "zh-Hans": "zh", "en-US": "en" }, "seed": "store/shots/seed.ts" },
  "reel":     { "content": "store/reel/content.ts" },
  "sim":      { "profile": "iphone69" }
}
```

## Keys

| Key | Type | Default | Meaning |
|---|---|---|---|
| `app.id` | string | — | App Store Connect app id (numeric). `storeship init` looks it up by bundle id; `storeship apps` lists them. Env `ASC_APP_ID` overrides. |
| `app.bundleId` | string | — | Bundle identifier. `ship` refuses when `ios/` disagrees. |
| `app.name` | string | — | Informational. |
| `asc.keyId` | string | — | API key id (App Store Connect → Users and Access → Integrations). Env `ASC_KEY_ID`. |
| `asc.issuerId` | string | — | Issuer id from the same page. Env `ASC_ISSUER_ID`. |
| `asc.keyPath` | path | `~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8` | The `.p8`. altool looks in the same place, so one location serves both. Env `ASC_KEY_PATH`. |
| `asc.teamId` | string | — | Apple team id, written into the generated ExportOptions.plist. `init` reads it from expo config (`ios.appleTeamId`). Env `ASC_TEAM_ID`. |
| `locales` | string[] | `[]` | ASC locale codes you localize for, e.g. `en-US`, `zh-Hans`, `ja`. Used by `whatsnew`, `listing`, `shots`, `preview`. |
| `ios.projectDir` | path | config dir | Directory with `app.config.*` / `app.json` and `ios/`. |
| `ios.workspace` | path | first `*.xcworkspace` under `<projectDir>/ios` | Xcode workspace to archive. |
| `ios.scheme` | string | workspace basename | Scheme to archive. |
| `ios.infoPlist` | path | `<projectDir>/ios/<scheme>/Info.plist` | Where the native version / build number are read for preflight. |
| `ios.configuration` | string | `Release` | Build configuration. |
| `ios.archiveDir` | path | `~/Library/Developer/Xcode/Archives` | Archives land in `<archiveDir>/<date>/<scheme> <version> build <n>.xcarchive`, so Xcode Organizer sees them. |
| `ios.exportOptions` | object | `{}` | Extra keys merged into the generated ExportOptions.plist (base: `method=app-store-connect`, `signingStyle=automatic`, `uploadSymbols=true`, `destination=export`). |
| `ios.expo` | boolean | auto | `false` for a bare native project (skips the `expo config` preflight). Auto-detected from `app.config.*` / `app.json`. |
| `listing.file` | path | `store-listing.md` | The store metadata file; format in the README. |
| `catalog.file` | path | `products.md` | Subscriptions, prices, territories and app price; format in the README (*Products as code*). |
| `whatsNew.dir` | path | `whats-new` | `version whatsnew` and `release` read `<dir>/<version>/<locale>.txt`. |
| `release.scheduledTime` | string | `00:00:00Z` | Time of day + zone appended to `--date` for scheduled releases, e.g. `08:00:00-07:00`. |
| `products` | object | `{}` | Alias → subscription id, for `offer` commands. |
| `shots.src` | path | `store/screenshots` | Raw simulator screenshots, `<prefix>-<localeTag>-<n>-<slug>.png`. |
| `shots.out` | path | `store/shots` | Rendered, ASC-ready PNGs. |
| `shots.content` | path | — | Module / JSON exporting `Shot[]` or `{ shots, devices?, template? }`. Required for `shots`. |
| `shots.template` | path | built-in | Module exporting a template `{ render(ctx), titleLines?, titleMax?, snPattern? }`. |
| `shots.devices` | string[] | every device the content lays out | Device ids to render by default. |
| `shots.locales` | string[] | `locales` | Locales to render. |
| `shots.localeTags` | object | `{}` | Locale code → short tag in filenames, e.g. `{"zh-Hans": "zh"}`. |
| `shots.seed` | path | — | Project script run by `shots seed`; arguments are passed through. |
| `reel.content` | path | — | Module / JSON exporting `{ canvas, band, crop?, rotate?, fps?, copy }`. Required for `reel`. |
| `reel.template` | path | built-in | Module exporting `{ render(ctx), css?(ctx) }`. |
| `sim.profile` | string | — | Default device id for `sim` / `preview record` (the simulator is picked by that device's name). |
| `sim.idb` | path | `~/.local/opt/idb/venv/bin/idb`, then PATH | idb binary. Env `STORESHIP_IDB`. |
| `chrome` | path | Google Chrome / Chromium / Edge in /Applications, then PATH | Headless browser for `shots` and `reel card`. Env `STORESHIP_CHROME`. |
| `ffmpeg` | path | PATH, then `~/.local/opt/ffmpeg/ffmpeg` | ffmpeg for `preview`. Env `STORESHIP_FFMPEG`. |

## Environment variables

| Variable | Overrides | Typical use |
|---|---|---|
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` | `asc.*` | Run one command with a different key (e.g. an Admin key for `analytics`) without touching the file. |
| `ASC_APP_ID`, `ASC_TEAM_ID` | `app.id`, `asc.teamId` | CI, or a second app sharing the repo. |
| `STORESHIP_CHROME`, `STORESHIP_FFMPEG`, `STORESHIP_IDB` | `chrome`, `ffmpeg`, `sim.idb` | Per-machine tool locations. |
| `STORESHIP_DEBUG` | — | Print stack traces for unexpected errors. |

## Device table

Built in: `iphone69` (1320×2868, `APP_IPHONE_67`, iPhone 17 Pro Max), `iphone67` (1290×2796), `iphone63` (1206×2622, `APP_IPHONE_61`, iPhone 17 Pro), `iphone65` (1284×2778), `iphone55` (1242×2208), `ipad13` (2064×2752, `APP_IPAD_PRO_3GEN_129`, iPad Pro 13-inch (M5)), `ipad129` (2048×2732), `ipad11` (1668×2388). A shots content file can add or override entries (`devices: { myId: { id, w, h, srcW, srcH, displayType, unit, prefix, sim } }`). The same table maps display types to App Preview types and sizes.
