---
name: storeship-reel
description: Make a vertical social video (Xiaohongshu / Reels / Shorts) from a simulator recording with storeship — a designed card with a hole for the video, audio aligned by frame timestamps. Use when asked for a promo clip, social video, or reel of the app.
---

# Reel with storeship

`storeship reel card | pts | make`. The card (title, points, brand, colours) comes from the project's `reel.content` file; the tool renders it with a transparent hole, rotates and crops the recording into the hole, and exports an mp4. Use `--json`.

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
