# English product walkthrough

A 60-second, 1920×1080, 30 fps animation for Diagnose's current positioning:

> Diagnose and fix problems remotely with your AI agent.

The nine scenes cover the reported problem, the user's probe, the session agent launcher, local permissions, endpoint encryption, investigation and repair planning, authorized changes, verification and audit, and local revocation.

The repair story is explicitly illustrative: an application uses port 8081 while its service listens on 8080. No real user's computer, credentials, device, or diagnostic data is accessed while rendering. The video does not imply automatic repair success or general automatic rollback.

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
