# English product walkthrough

A 60-second, 1920×1080, 30 fps animation for Diagnose's current positioning:

> Diagnose and fix problems remotely with your AI agent.

The nine scenes follow a USB gateway diagnosis. They show the on-site probe, the nine-letter invitation, manual agent mode with the native skill, pairing progress, and verification of an authorized correction. The closing screen points to both manual mode and the launcher with a device procedure.

In the illustrative scenario, a collector has an outdated USB serial port setting. The animation uses fictional readings and shows how a fresh value in the dashboard verifies the fix.

## Outputs

Generated under `video/output/`:

- `diagnose-agent-en-60s.mp4`: H.264/AAC video with English narration and burned-in captions.
- `diagnose-agent-en.srt` and `.vtt`: sentence-level English subtitles.
- `diagnose-agent-en-poster.png`: website poster.
- `storyboard-en.png`: nine-scene overview, generated with the preview command.

The website's public copies are stored in `site/media/`. The earlier Chinese video is retained unchanged and is not the site's default video.

## Reproduce

Use macOS with Node.js 22.18+, FFmpeg/ffprobe on PATH, the installed Samantha English voice, Helvetica Neue, and SF Mono. The render uses TypeScript and `@napi-rs/canvas`; narration is synthesized locally by `say`. The quiet background is generated in code, without a licensed music recording or an external AI service.

```sh
npm ci
npm run video:preview
npm run video:render
```

`video/scenes-en.json` contains the timeline and narration. `video/render-en.ts` generates the visuals, per-sentence speech, captions, and final encode. `DIAGNOSE_VIDEO_VOICE` can select another installed macOS voice. A speech service permission is required in restricted environments; empty speech output is rejected. The final MP4 is replaced only after successful encoding.

To regenerate frames with the existing narration and timing:

```sh
node --experimental-strip-types video/render-en.ts --frames-only
```

After checking the result, refresh the MP4, VTT, and poster in `site/media/`, then run `npm run build:site` and `npm run check:site` before deployment. Generated audio and intermediate frames are ignored by Git and excluded from npm packages.
