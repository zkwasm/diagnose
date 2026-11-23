import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

type Scene = { start: number; end: number; title: string; subtitle: string; voice: string };
type Cue = { start: number; end: number; text: string };
const base = import.meta.dirname, output = resolve(base, 'output'), audio = resolve(base, 'audio-en');
mkdirSync(output, { recursive: true }); mkdirSync(audio, { recursive: true });
const scenes: Scene[] = JSON.parse(readFileSync(resolve(base, 'scenes-en.json'), 'utf8'));
const W = 1920, H = 1080, FPS = 30, duration = 60, voice = process.env.DIAGNOSE_VIDEO_VOICE ?? 'Samantha';
const C = { paper: '#f5f5ee', ink: '#1b2825', muted: '#66716a', line: '#d7dcd0', green: '#365b3b', lime: '#d9ed9c', panel: '#1d2c25', dim: '#aab9a5', white: '#f1f3e9', pale: '#e5ebd9', amber: '#f0cf8c' };
GlobalFonts.registerFromPath('/System/Library/Fonts/HelveticaNeue.ttc', 'UI');
GlobalFonts.registerFromPath('/System/Library/Fonts/SFNSMono.ttf', 'Code');
const canvas = createCanvas(W, H), c = canvas.getContext('2d');
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - (1 - clamp(x)) ** 3;
let cues: Cue[] = [];
function box(x: number, y: number, w: number, h: number, fill = C.paper, radius = 18, stroke = '') { c.beginPath(); c.roundRect(x, y, w, h, radius); c.fillStyle = fill; c.fill(); if (stroke) { c.lineWidth = 2; c.strokeStyle = stroke; c.stroke(); } }
function text(value: string, x: number, y: number, size = 30, color = C.ink, weight = 500, mono = false, align: CanvasTextAlign = 'left') { c.font = `${weight} ${size}px ${mono ? 'Code' : 'UI'}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillText(value, x, y); }
function wrap(value: string, x: number, y: number, width: number, size = 28, color = C.muted, gap = 1.45) { c.font = `500 ${size}px UI`; let row = '', count = 0; for (const word of value.split(' ')) { const next = row ? row + ' ' + word : word; if (row && c.measureText(next).width > width) { text(row, x, y + count++ * size * gap, size, color); row = word; } else row = next; } if (row) text(row, x, y + count++ * size * gap, size, color); return count; }
function line(x1: number, y1: number, x2: number, y2: number, color = C.line, width = 2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.stroke(); }
function circle(x: number, y: number, r: number, color: string) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill(); }
function tick(x: number, y: number, color = C.green, scale = 1) { line(x - 10 * scale, y, x - 2 * scale, y + 8 * scale, color, 4 * scale); line(x - 2 * scale, y + 8 * scale, x + 15 * scale, y - 12 * scale, color, 4 * scale); }
function pill(label: string, x: number, y: number, width: number, dark = false) { box(x, y, width, 43, dark ? '#344a35' : C.pale, 21); text(label, x + width / 2, y + 28, 20, dark ? C.lime : C.green, 500, false, 'center'); }
function enter(local: number, start: number, draw: () => void) { const p = ease((local - start) / .5); c.save(); c.globalAlpha *= p; c.translate(0, 22 * (1 - p)); draw(); c.restore(); }
function terminal(x: number, y: number, w: number, h: number, label: string) { box(x, y, w, h, C.panel, 20); circle(x + 26, y + 27, 5, '#889d7b'); circle(x + 45, y + 27, 5, '#889d7b'); circle(x + 64, y + 27, 5, '#889d7b'); text(label, x + 100, y + 35, 22, C.dim); line(x, y + 58, x + w, y + 58, '#46563f', 1); }
function command(label: string, x: number, y: number, local: number, start: number, size = 31) { const length = Math.floor(clamp((local - start) / 1.1) * label.length); text(label.slice(0, length), x, y, size, C.lime, 500, true); }
function smallHeading(label: string, x = 100, y = 340) { text(label, x, y, 22, C.green, 500, true); }
function packet(x1: number, x2: number, y: number, local: number) { line(x1, y, x2, y, '#a4b494', 3); for (let i = 0; i < 3; i++) { const x = x1 + (x2 - x1) * ((local * .22 + i / 3) % 1); box(x - 7, y - 7, 14, 14, C.green, 3); } }
function header(time: number, index: number) { c.fillStyle = C.paper; c.fillRect(0, 0, W, H); box(94, 43, 43, 43, C.ink, 9); text('›_', 101, 74, 27, C.lime, 600, true); text('diagnose.', 151, 78, 37, C.ink, 700); text('REMOTE TROUBLESHOOTING / HUMAN PERMISSION', 390, 76, 20, C.green, 500, true); pill('ILLUSTRATIVE WALKTHROUGH', 1408, 43, 416); line(96, 118, 1824, 118); text(`${String(index + 1).padStart(2, '0')} / 09`, 1822, 214, 23, C.muted, 500, true, 'right'); line(100, 1039, 1820, 1039, C.line, 3); line(100, 1039, 100 + 1720 * time / duration, 1039, C.green, 3); text('DIAGNOSE.FENGINWIND.COM', 100, 1019, 17, C.muted, 500, true); text(`${String(Math.floor(time)).padStart(2, '0')} / 60s`, 1820, 1019, 17, C.muted, 500, true, 'right'); }
function draw(index: number, time: number) {
  const scene = scenes[index], local = time - scene.start;
  header(time, index); c.save(); c.globalAlpha = Math.min(ease(local / .32), ease((scene.end - time) / .28));
  if (index !== 0 && index !== 8) { text(scene.title, 100, 210, 53, C.ink, 600); text(scene.subtitle, 100, 265, 27, C.muted); }
  if (index === 0) {
    enter(local, .05, () => {
      smallHeading('REMOTE DEVICE DIAGNOSIS', 100, 238);
      text('The gateway is on.', 100, 385, 100, C.ink, 600);
      text('Readings stopped.', 100, 510, 100, C.green, 500);
      wrap('Use your AI agent to investigate through the computer next to the device.', 105, 639, 970, 37);
    });
    enter(local, .45, () => {
      terminal(1170, 260, 650, 473, 'IOT DASHBOARD');
      text('Workshop gateway', 1212, 414, 40, C.white, 600);
      text('Last reading', 1212, 498, 28, C.dim);
      text('42 W', 1212, 601, 78, C.lime, 600, true);
      line(1210, 643, 1776, 643, '#46563f');
      text('Waiting for new data', 1212, 690, 26, C.amber);
    });
  } else if (index === 1) {
    enter(local, .05, () => {
      terminal(100, 335, 1150, 465, 'ON-SITE COMPUTER');
      command('$ npx @masstensor/diagnose@latest start', 140, 463, local, .5, 32);
      enter(local, 1.6, () => text('Selected: a · Auto tasks only', 140, 532, 29, C.white));
      enter(local, 2.6, () => {
        text('One-time invitation · Two hours', 140, 604, 26, C.dim);
        box(140, 632, 1040, 100, '#2f4432', 12);
        text('abc-def-ghi', 167, 695, 42, C.lime, 600, true);
        pill(local > 5.1 ? 'COPIED' : 'COPY CODE', 955, 660, 182, true);
      });
    });
    enter(local, .4, () => {
      box(1310, 335, 510, 465, C.pale, 23);
      smallHeading('ON SITE', 1350, 394);
      text('Gateway', 1350, 479, 42, C.ink, 600);
      line(1371, 507, 1371, 566, '#9bb384', 4);
      text('USB data cable', 1402, 545, 29, C.green);
      text('Computer', 1350, 632, 42, C.ink, 600);
      wrap('Keep this terminal open and share the invitation privately.', 1350, 704, 418, 27);
    });
  } else if (index === 2) {
    enter(local, .05, () => {
      terminal(100, 335, 1130, 465, 'CODEX · DIAGNOSTICIAN');
      command('$diagnose:connect', 140, 476, local, .7, 38);
      enter(local, 2.2, () => text('Invitation: abc-def-ghi', 140, 554, 30, C.lime, 500, true));
      enter(local, 3.0, () => wrap('The gateway is connected by USB. Find why fresh readings stopped reaching the dashboard.', 140, 634, 1010, 35, C.white, 1.3));
    });
    enter(local, .5, () => {
      box(1285, 335, 535, 465, C.pale, 23);
      smallHeading('INSTALL THE SKILL ONCE', 1325, 397);
      wrap('Follow the GitHub install steps for your agent.', 1325, 475, 448, 32, C.ink);
      line(1325, 560, 1775, 560, '#c4d1b8');
      text('Claude Code', 1325, 615, 24, C.muted);
      text('/diagnose:connect', 1325, 659, 30, C.green, 500, true);
      text('Gemini CLI · use the connect skill', 1325, 736, 26, C.green);
    });
  } else if (index === 3) {
    enter(local, .05, () => {
      terminal(100, 335, 1060, 465, 'PAIRING PROGRESS · AGENT');
      ['Relay connected', 'Probe authenticated · waiting for acceptance', 'Paired with the on-site probe'].forEach((label, i) => enter(local, .5 + i * 1.15, () => {
        tick(157, 460 + i * 104, i === 1 ? C.amber : C.lime, .8);
        text(label, 197, 470 + i * 104, 31, i === 1 ? C.amber : C.white);
      }));
    });
    enter(local, .5, () => {
      box(1220, 335, 600, 465, C.pale, 23);
      smallHeading('ON-SITE CONFIRMATION', 1260, 399);
      text('Auto tasks only', 1260, 485, 41, C.ink, 600);
      wrap('Checks and results are automatic once the user confirms pairing.', 1260, 552, 510, 31);
      enter(local, 1.9, () => pill('y · CONFIRM', 1260, 664, 235));
      text('Review and Approve everything are also available.', 1260, 754, 23, C.green);
    });
  } else if (index === 4) {
    const nodes = [
      { label: 'AI AGENT', detail: 'Remote diagnostician' },
      { label: 'RELAY', detail: 'Encrypted traffic' },
      { label: 'ON-SITE COMPUTER', detail: 'Diagnose probe' },
      { label: 'IOT GATEWAY', detail: 'Connected by USB' },
    ];
    packet(450, 556, 507, local);
    packet(906, 1012, 507, local + .5);
    line(1362, 507, 1468, 507, C.green, 3);
    nodes.forEach((node, i) => enter(local, .1 + i * .2, () => {
      const x = 100 + 456 * i;
      const light = i === 1 || i === 3;
      box(x, 368, 350, 280, light ? C.pale : C.panel, 24);
      text(node.label, x + 175, 466, 26, light ? C.green : C.lime, 600, true, 'center');
      text(node.detail, x + 175, 566, 27, light ? C.muted : C.dim, 500, false, 'center');
    }));
    enter(local, 1.2, () => text('The diagnostician and their AI provider can see the results.', 960, 758, 29, C.green, 500, false, 'center'));
  } else if (index === 5) {
    enter(local, .05, () => {
      terminal(100, 335, 915, 470, 'READ-ONLY CHECKS');
      const rows = ['Probe confirmed online', 'Gateway serial port: usbserial-B', 'Gateway sample at 10:42:08: 43 W', 'Collector setting: usbserial-A'];
      rows.forEach((row, i) => enter(local, .55 + i * .8, () => {
        text(String(i + 1).padStart(2, '0'), 140, 456 + i * 87, 22, C.dim, 500, true);
        text(row, 205, 456 + i * 87, 27, i === 3 ? C.amber : C.white, 500, true);
      }));
    });
    enter(local, 2.8, () => {
      box(1065, 335, 755, 470, C.pale, 24);
      smallHeading('AGENT FINDING', 1105, 398);
      text('Stale port setting', 1105, 483, 50, C.ink, 600);
      wrap('The gateway is producing readings. The collector is listening on its previous USB serial port.', 1105, 570, 663, 33, C.green);
      text('Proposed change: update the collector.', 1105, 755, 27, C.green);
    });
  } else if (index === 6) {
    enter(local, .05, () => {
      terminal(100, 335, 920, 467, 'ON-SITE COLLECTOR CONFIGURATION');
      const rows = [['Previous port', 'device_port = usbserial-A'], ['Confirmed port', 'device_port = usbserial-B']];
      rows.forEach(([label, value], i) => {
        text(label, 140, 462 + i * 121, 25, C.dim);
        text(value, 140, 513 + i * 121, 34, i === 1 ? C.lime : C.white, 500, true);
      });
      enter(local, 3.0, () => { tick(160, 747, C.lime); text('Approved change applied', 198, 759, 28, C.white); });
    });
    enter(local, .7, () => {
      box(1090, 335, 730, 467, C.pale, 24);
      smallHeading('AGENT CHAT', 1130, 398);
      wrap('I can update the collector setting and restore the old value if needed.', 1130, 492, 630, 33, C.ink);
      enter(local, 1.8, () => {
        box(1130, 618, 640, 110, '#dde9cf', 14);
        wrap('Approved. Check the dashboard afterward.', 1160, 662, 575, 29, C.green, 1.2);
      });
    });
  } else if (index === 7) {
    enter(local, .05, () => {
      box(100, 335, 1000, 470, C.pale, 24);
      smallHeading('IOT DASHBOARD · SAME DEVICE', 140, 400);
      text('New reading received', 140, 507, 57, C.ink, 600);
      enter(local, .8, () => {
        circle(170, 625, 28, C.green); tick(170, 625, C.lime, 1.1);
        text('10:43:12 · 44 W', 230, 642, 50, C.green, 600, true);
      });
      wrap('The new value matches the collector’s latest reading.', 140, 740, 895, 30);
    });
    enter(local, .4, () => { terminal(1160, 335, 660, 470, 'LOCAL AUDIT TRAIL · EXAMPLE'); const rows = ['Approval decision', 'Operation + target', 'File change hashes', 'Bytes collected / sent', 'Outcome']; rows.forEach((row, i) => enter(local, .9 + i * .45, () => { tick(1210, 443 + i * 65, C.lime, .65); text(row, 1245, 454 + i * 65, 27, C.white); })); });
  } else if (index === 8) {
    enter(local, .05, () => {
      smallHeading('OPEN SOURCE REMOTE DIAGNOSIS', 100, 224);
      text('Start your first', 100, 367, 101, C.ink, 600);
      text('diagnosis.', 100, 484, 101, C.green, 500);
      text('diagnose.fenginwind.com/guide/', 105, 637, 40, C.green);
    });
    enter(local, .3, () => {
      box(1170, 255, 650, 488, C.pale, 23);
      smallHeading('CHOOSE HOW TO START', 1210, 324);
      text('Manual agent mode', 1210, 414, 40, C.ink, 600);
      text('Describe the problem in chat.', 1210, 469, 30, C.muted);
      line(1210, 530, 1780, 530, '#c4d1b8');
      text('Start with a procedure', 1210, 620, 40, C.ink, 600);
      text('--skill ./device.md', 1210, 681, 32, C.green, 500, true);
    });
  }
  c.restore();
  const cue = cues.find(value => time >= value.start && time < value.end) ?? cues.filter(value => value.start >= scene.start && value.start <= time).at(-1);
  const subtitle = cue?.text ?? scene.voice.split(/(?<=[.!?])\s+/)[0];
  box(95, 890, 1730, 100, C.panel, 15);
  c.font = '500 31px UI';
  if (c.measureText(subtitle).width < 1630) text(subtitle, 960, 952, 31, C.white, 500, false, 'center'); else wrap(subtitle, 140, 931, 1630, 29, C.white, 1.35);
}
function run(program: string, args: string[]) { const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`${program}: ${result.stderr}`); return result.stdout; }
function audioDuration(path: string) { const value = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path]).trim()); if (!Number.isFinite(value) || value < .1) throw new Error(`Empty audio: ${path}`); return value; }
function prepareAudio() {
  const inputs: string[] = [], filters: string[] = []; cues = []; let input = 0;
  for (const [i, scene] of scenes.entries()) {
    const sentences = scene.voice.split(/(?<=[.!?])\s+/).filter(Boolean);
    const clips = sentences.map((sentence, j) => { const path = resolve(audio, `${i}-${j}.aiff`); run('say', ['-v', voice, '-r', '174', '-o', path, sentence]); return { path, text: sentence, duration: audioDuration(path) }; });
    const gap = .09, available = scene.end - scene.start - .4 - gap * (clips.length - 1), total = clips.reduce((n, clip) => n + clip.duration, 0), tempo = Math.max(1, total / available);
    if (tempo > 1.35) throw new Error(`Narration scene ${i + 1} is too fast: ${tempo.toFixed(2)}x`);
    let at = scene.start + .18;
    for (const [j, clip] of clips.entries()) { const path = resolve(audio, `${i}-${j}.wav`); run('ffmpeg', ['-v', 'error', '-y', '-i', clip.path, '-af', `atempo=${tempo.toFixed(6)},afade=t=in:d=0.015`, '-ar', '48000', '-ac', '1', path]); const length = audioDuration(path); inputs.push('-i', path); filters.push(`[${input}:a]adelay=${Math.round(at * 1000)}:all=1[a${input}]`); const end = j === clips.length - 1 ? scene.end - .1 : at + length + gap / 2; cues.push({ start: at, end, text: clip.text }); at += length + gap; input++; }
    console.log(`Narration ${i + 1}/9: ${total.toFixed(2)}s, tempo ${tempo.toFixed(2)}x`);
  }
  const rate = 48000, bytes = Buffer.alloc(44 + rate * duration * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const chords = [[130.81, 164.81, 196], [110, 130.81, 164.81], [87.31, 130.81, 174.61], [98, 146.83, 196]];
  for (let sample = 0; sample < rate * duration; sample++) { const t = sample / rate, position = t % 8, envelope = Math.max(0, Math.min(1, position / 2, (8 - position) / 2, t / 2, (60 - t) / 2)); let value = 0; for (const hz of chords[Math.floor(t / 8) % chords.length]) value += Math.sin(t * Math.PI * 2 * hz) * .0022 * envelope; bytes.writeInt16LE(Math.round(value * 32767), 44 + sample * 2); }
  const ambience = resolve(audio, 'ambience.wav'); writeFileSync(ambience, bytes); inputs.push('-i', ambience);
  const mix = Array.from({ length: input }, (_, i) => `[a${i}]`).join('');
  run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${filters.join(';')};${mix}amix=inputs=${input}:normalize=0,apad=whole_dur=60,loudnorm=I=-16:TP=-2:LRA=9[voice];[voice][${input}:a]amix=inputs=2:normalize=0,alimiter=limit=0.93[out]`, '-map', '[out]', '-t', '60', '-ar', '48000', resolve(audio, 'mix.wav')]);
  writeFileSync(resolve(audio, 'cues.json'), JSON.stringify(cues, null, 2));
}
const timecode = (seconds: number, separator: string) => { const ms = Math.round(seconds * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`; };
function captions() { writeFileSync(resolve(output, 'diagnose-agent-en.srt'), cues.map((cue, i) => `${i + 1}\n${timecode(cue.start, ',')} --> ${timecode(cue.end, ',')}\n${cue.text}\n`).join('\n')); writeFileSync(resolve(output, 'diagnose-agent-en.vtt'), 'WEBVTT\n\n' + cues.map(cue => `${timecode(cue.start, '.')} --> ${timecode(cue.end, '.')}\n${cue.text}\n`).join('\n')); }
const mode = process.argv[2];
if (mode === '--preview') {
  cues = scenes.flatMap(scene => [{ start: scene.start, end: scene.end, text: scene.voice.split(/(?<=[.!?])\s+/)[0] }]);
  const sheet = createCanvas(1920, 1080), sc = sheet.getContext('2d');
  for (const [index, scene] of scenes.entries()) { draw(index, scene.end - 1); const path = resolve(output, `en-scene-${index + 1}.png`); writeFileSync(path, canvas.toBuffer('image/png')); sc.drawImage(await loadImage(path), index % 3 * 640, Math.floor(index / 3) * 360, 640, 360); }
  writeFileSync(resolve(output, 'storyboard-en.png'), sheet.toBuffer('image/png')); console.log('English storyboard rendered.');
} else {
  if (mode !== '--frames-only') prepareAudio(); else cues = JSON.parse(readFileSync(resolve(audio, 'cues.json'), 'utf8'));
  captions();
  const temporary = resolve(output, 'diagnose-agent-en-rendering.mp4'), destination = resolve(output, 'diagnose-agent-en-60s.mp4');
  const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0', '-i', resolve(audio, 'mix.wav'), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-metadata:s:a:0', 'language=eng', '-metadata:s:v:0', 'language=eng', '-t', '60', '-movflags', '+faststart', '-metadata', 'title=Diagnose and fix problems remotely with your AI agent', '-metadata', 'comment=English animated product walkthrough. Illustrative repair example, not a live session. Human permission, endpoint encryption, remote tools, and result verification.', temporary], { stdio: ['pipe', 'inherit', 'inherit'] });
  const completed = once(encoder, 'close'); encoder.stdin.on('error', () => {});
  for (let frame = 0; frame < FPS * duration; frame++) { const time = frame / FPS, index = scenes.findIndex(scene => time >= scene.start && time < scene.end); draw(index, time); if (!encoder.stdin.write(canvas.data())) await once(encoder.stdin, 'drain'); if (frame % (FPS * 5) === 0) console.log(`Rendering ${Math.round(time)} / 60s`); }
  encoder.stdin.end(); const [code] = await completed; if (code !== 0) throw new Error('Video encoder failed'); renameSync(temporary, destination);
  run('ffmpeg', ['-v', 'error', '-y', '-ss', '3.5', '-i', destination, '-frames:v', '1', resolve(output, 'diagnose-agent-en-poster.png')]);
  console.log(destination);
}
