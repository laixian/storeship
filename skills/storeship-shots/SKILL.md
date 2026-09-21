---
name: storeship-shots
description: Produce App Store screenshots with storeship — drive the simulator, capture real screens, compose them on a canvas with titles, validate, review the contact sheet, upload. Use when asked to make, update, or upload store screenshots.
---

# App Store screenshots with storeship

<!-- storeship 0.4.1 — generated blocks below are written by `storeship skill sync`; do not edit them by hand -->

The tool renders real screenshots, each inside a drawn device, from one project file: the **content** (which screens in what order, titles per locale, a style). Where every phone goes is decided by fixed layout rules, not by the content; what it looks like is the **style** (`plain`, `stage`, `color`, or a project module built with `extendStyle`). Commands: `storeship shots check`, `storeship shots render`, `storeship shots styles`, `storeship shots upload`, `storeship shots seed`, and `storeship sim` to drive the simulator.

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

`storeship state --json` says where the release is and what to run next; `storeship spec --json` is the whole command tree with each command's impact and prerequisites.

## The procedure

1. **Install a Release build on the simulator** (`expo run:ios --device "<sim name>" --configuration Release`). A debug build shows developer-only UI and stale JS; a Release build bakes JS into `main.jsbundle` and ignores Metro afterwards.
2. **Seed demo data** with `storeship shots seed -- <args>` if the project has a seed script (`shots.seed`), then restart the app (`xcrun simctl terminate` / `launch`) — data is usually read at launch.
3. **Status bar**: `storeship sim statusbar` (9:41, full battery).
4. **Capture** each screen into `shots.src` as `<prefix>-<localeTag>-<stem>.png` (e.g. `iphone-en-3-leadsheet.png`); capture whole screens — every screen is shown whole inside a device. Drive with `storeship sim find "<label>"` (accessibility, needs idb), `sim tap x y` (device points, portrait), `sim ltap x y` for landscape pages (pixels measured on the rotated screenshot), `sim shot out.png [270]` (270 for landscape). Measure coordinates on the device screenshot ÷ scale, never on a thumbnail.
5. **Edit the content file**: frames, titles, style (`storeship shots styles --json` lists styles and their theme tokens). Run `storeship shots check --json` until it is clean; it reports every problem at once, and exits 3 (`CHECK_FAILED`) while any remain — nothing is rendered from a failing check, on purpose.
6. `storeship shots render --sheet --json`, then **open the contact sheets and look at the row** — the store-spaced one for how it reads, the seamless one for what crosses the seams. This is the only real acceptance test; single frames all look fine on their own. Show it to the human.
7. `storeship shots upload <version> --dry-run --json`, show the plan, then upload. Sets inherit from the previous version; only changed files need uploading. `--replace` wipes a set first.

## Writing titles (the human decides the words; you draft)

- Two lines, no subtitle. People scan the store; one idea per frame.
- Consequence, not mechanism ("stops counting bars", not "20ms sync").
- Each locale is a rewrite, not a translation — English runs 30–50% wider.
- Order is narrative: the first three frames decide whether anyone scrolls; a directory/home screen goes last, not first.

## Layout (the tool enforces it; know why)

- **One phone size for the whole set.** A landscape screen is the same phone turned, so it runs off one side of the canvas; choose `anchor: 'start'` or `'end'` so the half that matters stays. Pick screens whose point is in that half — centred content gets cut in the middle.
- **Only the hero tilts.** A hero (`hero: {}`) is one phone across store slots 1–2, cut by the seam near its middle; slot 1 carries the brand (logo cropped from a real screenshot), slot 2 the title. It is two of the ten screenshots, and iPhone search results show the first three side by side — that row is what the hero is for.
- **One phone per frame.** A second phone is the exception, and two-phone frames are never neighbours; a run of them reads as clutter even when each frame is fine.
- Counters count store slots, hero halves included (`02/08`).
- A crop is gone: a device always shows the whole screen. Never composite screens that do not exist (App Store guideline 2.3.3).
- Layout does not scale between devices by hand; the rules re-run per device. Still look at every device's sheet.
- Keep the raw screenshots; every re-render starts from them.

## Never

- Never retouch screenshots or invent UI.
- Never print copyrighted lyrics or real users' names in demo data; never use placeholder-sounding text ("test line 2").
- Never upload without showing the contact sheet and the `--dry-run` plan first.
