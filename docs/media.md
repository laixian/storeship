# Screenshots, previews and social video

Everything that produces a picture or a film: store screenshots composed from real simulator captures, the simulator driver behind them, App Preview videos, and vertical social clips. None of it is in the release path — a release command that fails on a screenshot diff is a release command nobody dares to run.

[← README](../README.md) · [command reference](commands.md) · [configuration](config.md) · [for agents](agents.md)

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
