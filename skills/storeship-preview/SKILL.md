---
name: storeship-preview
description: Make an App Store preview video with storeship — record the simulator, cut VFR footage into a spec-size film with crossfades and music, check it, upload it. Use when asked to record, cut, or upload an App Preview / store video.
---

# App Preview with storeship

<!-- storeship 0.3.0 — generated blocks below are written by `storeship skill sync`; do not edit them by hand -->

An App Preview is 15–30 s of real screen recording, no device frame, at an exact size per device (1920×886 landscape / 886×1920 portrait for iPhone, 1200×1600 for iPad). Commands: `storeship preview record`, `storeship preview stop`, `storeship preview cut`, `storeship preview check`, `storeship preview upload`, plus `storeship sim` to drive the app.

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

1. **Release build on the simulator**, demo data seeded (`storeship shots seed -- …` if the project has it), app restarted, `storeship sim statusbar`.
2. **Pre-warm** anything that loads slowly on first use (audio engines, models) by triggering it once before recording; a first-time progress bar reads as a hang in a 30 s film.
3. **Record one segment per scene**: `storeship preview record segN.mov --device <id>`, drive with `storeship sim find "<label>"` / `tap` / `ltap`, then **`storeship preview stop`**. Never kill the recorder process: the session leaks inside CoreSimulator, every later recording fails with "Host recording is already in progress", and only rebooting that simulator fixes it (then set the status bar again).
4. **Cut**: `storeship preview cut out.mp4 seg1.mov:0:8:p seg2.mov:1:7 … --device <id> [--music file.wav]`. `:p` = a portrait page (letterboxed, not rotated). Start the first segment at 0: trimming the head drops the first frame and, on VFR footage, the whole opening. Read the "requested vs got" lines — VFR sources give less than asked, that is normal; the crossfades are computed from what was produced.
5. `storeship preview check out.mp4 --device <id>` — size, 15–30 s, ≤ 30 fps, frame count. Exit 3 means it does not meet the spec; App Store Connect would reject it, and `preview upload` refuses it. Show the result and the film to the human.
6. `storeship preview upload <version> out.mp4 --device <id> --locale <L>`; one file per locale × device. The poster frame is picked in the App Store Connect web UI after processing.

## Music

Simulator recordings carry no app audio. If the project can render the audio that was playing on screen offline, use that and align it by frame timestamps, not by ear: the first frame of a steady cadence in the recording (e.g. a beat-driven redraw) is the audio's t0. Otherwise use royalty-free music or none — most store viewers watch muted.

## The human decides

- The scenes and their order (the first two seconds decide whether anyone keeps watching).
- Segment in/out points; propose them from the timestamps and let the human confirm on the cut film.
- Whether to upload, and which locale × device slots.

## Never

- Never composite UI that does not exist, add device frames, or speed footage up beyond what the app does.
- Never kill `recordVideo`; always `preview stop`.
- Never upload a file `preview check` rejects.
