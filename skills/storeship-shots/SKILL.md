---
name: storeship-shots
description: Produce App Store screenshots with storeship — drive the simulator, capture real screens, compose them on a canvas with titles, validate, review the contact sheet, upload. Use when asked to make, update, or upload store screenshots.
---

# App Store screenshots with storeship

The tool renders real screenshots onto a canvas from two project files: a **content** file (which screens, titles per locale, background, crop rectangles per device) and a **template** module (what the canvas looks like). Commands: `storeship shots check | render | upload | seed`, `storeship sim …`. Always use `--json`.

## The procedure

1. **Install a Release build on the simulator** (`expo run:ios --device "<sim name>" --configuration Release`). A debug build shows developer-only UI and stale JS; a Release build bakes JS into `main.jsbundle` and ignores Metro afterwards.
2. **Seed demo data** with `storeship shots seed -- <args>` if the project has a seed script (`shots.seed`), then restart the app (`xcrun simctl terminate` / `launch`) — data is usually read at launch.
3. **Status bar**: `storeship sim statusbar` (9:41, full battery).
4. **Capture** each screen into `shots.src` as `<prefix>-<localeTag>-<n>-<slug>.png` (use `<n>b-<slug>` for a second screen of the same shot). Drive with `storeship sim find "<label>"` (accessibility, needs idb), `sim tap x y` (device points, portrait), `sim ltap x y` for landscape pages (pixels measured on the rotated screenshot), `sim shot out.png [270]` (270 for landscape). Measure coordinates on the device screenshot ÷ scale, never on a thumbnail.
5. **Edit the content file**: titles, background, crops. Run `storeship shots check --json` until it is clean; it reports every problem at once.
6. `storeship shots render --sheet --json`, then **open the contact sheet and look at the row**. This is the only real acceptance test; single frames all look fine on their own. Show it to the human.
7. `storeship shots upload <version> --dry-run --json`, show the plan, then upload. Sets inherit from the previous version; only changed files need uploading. `--replace` wipes a set first.

## Writing titles (the human decides the words; you draft)

- Two lines, no subtitle. People scan the store; one idea per frame.
- Consequence, not mechanism ("stops counting bars", not "20ms sync").
- Each locale is a rewrite, not a translation — English runs 30–50% wider.
- Order is narrative: the first three frames decide whether anyone scrolls; a directory/home screen goes last, not first.

## Crops and layout

- `sx/sy/sw` is a rectangle on the source; height follows the card's aspect. A crop is "zoom into a corner of the same screen" — never a composite of screens that do not exist (App Store guideline 2.3.3).
- Never bleed on both sides: no visible corner means it reads as a colour band. `check` blocks this.
- Two cards must show different regions, or it reads as the same picture printed twice. A second card is optional: if there is nothing else to say, use one.
- One crop must cover **both** locales' UI: strings and popovers shift with language.
- Layouts do not scale between devices; the template's `unit` scales type and spacing only. Lay out each device on its own canvas and look.
- Keep the raw screenshots; every re-render starts from them.

## Never

- Never retouch screenshots or invent UI.
- Never print copyrighted lyrics or real users' names in demo data; never use placeholder-sounding text ("test line 2").
- Never upload without showing the contact sheet and the `--dry-run` plan first.
