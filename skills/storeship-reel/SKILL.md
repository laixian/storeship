---
name: storeship-reel
description: Make a vertical social video (Xiaohongshu / Reels / Shorts) from a simulator recording with storeship — a designed card with a hole for the video, audio aligned by frame timestamps. Use when asked for a promo clip, social video, or reel of the app.
---

# Reel with storeship

<!-- storeship 0.3.0 — generated blocks below are written by `storeship skill sync`; do not edit them by hand -->

`storeship reel card`, `storeship reel pts`, `storeship reel make`. The card (title, points, brand, colours) comes from the project's `reel.content` file; the tool renders it with a transparent hole, rotates and crops the recording into the hole, and exports an mp4.

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

## Procedure

1. Release build on the simulator, demo data seeded, status bar set (`storeship sim statusbar`). Dev builds leak developer UI into the frame.
2. **Warm up** anything slow on first use, then record the scene: `storeship preview record take.mov` … `storeship preview stop`.
3. Draft the copy in the content file (title lines, points, brand). The human approves the words. `storeship reel card /tmp/card.png` to show the card alone.
4. `storeship reel make take.mov out.mp4 --start S --duration D`. If it says "band height must be N", set `band.h` to N in the content file (the recording's aspect after crop decides it) and run again.
5. **Audio**: simulator recordings have no app sound. If the project can render what was playing offline, align it by frame timestamps, not by ear: `storeship reel pts take.mov` lists steady-cadence runs (a beat-driven redraw yields one frame per beat); the **first frame of that run** is where the audio's t=0 goes → `--audio file.wav --audio-t0 <that t>`. Not the frame where play was pressed — the playhead starts a frame later.
6. Show the human the mp4. You can verify alignment (the first downbeat frame matches the audio's first downbeat); you cannot verify that it sounds good — say so.

## Notes

- A recording at ~1.5 fps is not broken when the app redraws per beat; the gap equals one beat.
- `crop.left` usually exists to hide the Dynamic Island on landscape recordings; do not remove it because the picture "loses width".
- The card is a foreground with a hole. Never give the card a background; the tool's panes are the background.

## Never

- Never publish demo content with copyrighted lyrics or real users' names.
- Never change `band` in one place only — there is only one place (the content file); the template reads it.
