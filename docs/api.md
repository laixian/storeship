# Library use

Everything the CLI does is a function you can import; the commands are thin shells. All exports come from the package root.

```ts
import { createClient, listVersions, attachLatestBuild, submitVersion, readListing, diffListing, pushListing,
         mediaStatus, uploadMedia, createOffer, loadConfig, resolveConfig, hintFor } from 'storeship'

const cfg = await loadConfig({ cwd: process.cwd() })
const asc = createClient({ keyId: cfg.asc.keyId!, issuerId: cfg.asc.issuerId!, keyPath: cfg.asc.keyPath })
for (const v of await listVersions(asc, cfg.app.id!)) console.log(v.version, v.state)
```

| Area | Exports |
|---|---|
| Client | `createClient({ keyId, issuerId, keyPath \| keyPem, fetch?, base? })` → `{ get, post, patch, delete, request, all, raw, token }`; `signJwt`, `explain`, `ok`, `AscError` |
| Versions | `listVersions`, `findVersion`, `requireVersion`, `createVersion`, `versionLocalizations`, `writeWhatsNew`, `listBuilds`, `attachLatestBuild` (with `wait`, `sleep`, `onWait` injectable), `submitVersion`, `cancelSubmissions` |
| Listing | `parseListing`, `readListing`, `LIMITS`, `len`, `overLimit`, `diffFields`, `editableAppInfo`, `diffListing`, `pushListing` |
| Media | `mediaStatus`, `uploadMedia`, `createScreenshotSet`, `createPreviewSet`, `setItems`, `deleteMedia` |
| Offers, analytics, misc | `listOffers`, `createOffer`, `downloadCodes`, `deactivateOffer`; `requestReport`, `listReports`, `fetchReport`, `salesReport`; `registerDevice`, `findAppByBundleId`, `listApps`, `appLocales` |
| iOS build | `resolveProject`, `readVersions`, `expoConfig`, `exportOptionsPlist`, `archive`, `exportArchive`, `uploadIpa` |
| Screenshots | `DEVICES`, `PREVIEW_TYPE`, `mergeDevices`, `checkShots`, `renderShot`, `shoot`, `sheet`, `pngSize`, `findChrome`, `defaultTemplate`, `loadShots`, `uploadShots`, and the `Shot` / `Card` / `Device` / `Template` types |
| Simulator | `Sim` (tap, ltap, drag, shot, statusBar, tree, find, tapLabel, text), `findIdb`, `bootedUdid` |
| Preview | `findFfmpeg`, `probe`, `parseProbe`, `cutPreview`, `parseSegment`, `xfadeChain`, `checkPreview`, `defaultSize`, `PREVIEW_SIZES`, `startRecording`, `stopRecording` |
| Reel | `cardHtml`, `panes`, `renderCard`, `defaultReelTemplate`, `makeReel`, `framePts`, `steadyRuns`, `loadReel` |
| Config, errors, hints | `loadConfig`, `resolveConfig`, `findConfigFile`, `defaultKeyPath`; `StoreshipError`, `UsageError`, `ConfigError`, `NeedsHuman`, `CheckFailed`, `asStoreshipError`; `HINTS`, `hintFor`, `hintTextFor`; `renderCommandDocs` |
| The agent contract | `EXIT`, `EXIT_MEANING`, `CODES`, `codeMeta`, `PROTOCOL`, `VERSION`; `fullSpec`, `commandSpec`; `Out` (the envelope), `project`; `stageOf`, `pickVersion`; `syncSkill`, `checkSkill`, `mentionedCommands`, `stampOf` — see [for agents](agents.md) |

The pure functions (`parseListing`, `diffFields`, `xfadeChain`, `steadyRuns`, `checkShots` with an injected fs, `signJwt`, `stageOf`) have no I/O and are the ones with tests; the client accepts a `fetch` for testing against a fake.

`hintFor` returns the matching entry (`{ code, hint, humanAction? }`), not a string — `hintTextFor` is the string. Every error the CLI raises on purpose carries `code`, `retry` and, when nothing but a person can clear it, `humanAction`; `error.toJSON()` is exactly what `--json` prints.
