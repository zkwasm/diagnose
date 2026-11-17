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
    enter(local, .05, () => { smallHeading('AGENT-LED REMOTE TROUBLESHOOTING', 100, 215); text('Diagnose and fix.', 100, 365, 109, C.ink, 600); text('Remotely, with', 100, 492, 101, C.green, 500); text('your AI agent.', 100, 610, 101, C.green, 500); wrap('A computer. A connected device. A problem worth solving.', 105, 712, 1010, 34); });
    enter(local, .45, () => { box(1250, 220, 570, 562, C.pale, 27, '#cbd6bd'); const labels = ['REPORTED PROBLEM', 'INVESTIGATE', 'AUTHORIZED FIX', 'CHECK THE RESULT']; labels.forEach((label, i) => { const y = 285 + i * 133; if (i) line(1535, y - 87, 1535, y - 51, '#9bb384', 3); box(1300, y - 26, 470, 68, i === 3 ? C.green : C.paper, 12); text(label, 1535, y + 17, 24, i === 3 ? C.lime : C.green, 500, true, 'center'); if (i === 3) tick(1730, y + 5, C.lime, .8); }); });
  } else if (index === 1) {
    enter(local, .05, () => { terminal(100, 335, 1150, 435, "USER'S COMPUTER"); command('$ npx @masstensor/diagnose@latest start', 140, 468, local, .6, 32); if (local > 1.8) { text('Pairing code (10 minutes, share privately):', 140, 553, 26, C.dim); box(138, 584, 1068, 109, '#2f4432', 12); text('D1.<route>.<random-secret>', 164, 632, 36, C.lime, 500, true); text('Example only — not a usable pairing code', 165, 671, 22, C.dim); } });
    enter(local, .4, () => { box(1310, 335, 510, 435, C.pale, 23); smallHeading('FIRST-TIME SETUP', 1350, 394); text('Install Node.', 1350, 478, 46, C.ink, 600); text('npm is included.', 1350, 542, 36, C.green); wrap('Windows and Mac instructions are in the user guide.', 1350, 615, 425, 28); });
  } else if (index === 2) {
    enter(local, .05, () => { terminal(100, 335, 1130, 445, "DIAGNOSTICIAN'S COMPUTER"); command('$ npx @masstensor/diagnose@latest agent codex', 140, 478, local, .5, 30); text('Or replace codex with:', 140, 557, 25, C.dim); text('claude', 140, 612, 30, C.white, 500, true); text('gemini', 140, 661, 30, C.white, 500, true); text('Agent CLI must already be installed and signed in.', 140, 738, 22, C.dim); });
    enter(local, .5, () => { box(1285, 335, 535, 445, C.pale, 23); smallHeading('FOR THIS LAUNCH', 1325, 397); text('Your agent', 1325, 483, 44, C.ink, 600); text('+ remote tools', 1325, 546, 43, C.green, 600); line(1325, 584, 1775, 584, '#c4d1b8'); wrap('No permanent MCP entry. Give the agent the code and describe what is failing.', 1325, 636, 437, 29); });
  } else if (index === 3) {
    enter(local, .05, () => { terminal(100, 335, 1060, 459, 'LOCAL CONNECTION APPROVAL'); text('Requested by: Your diagnostician / AI provider', 140, 450, 25, C.white, 500, true); text('Label is self-reported. Check the fingerprint.', 140, 499, 23, C.dim); const rows = [['y', 'Review each task and result transfer'], ['a', 'Auto execute AND transmit this session'], ['N', 'Decline the connection']]; rows.forEach(([key, label], i) => { box(140, 539 + i * 70, 48, 47, i === 0 ? C.lime : '#354936', 9); text(key, 164, 572 + i * 70, 27, i === 0 ? C.ink : C.lime, 600, true, 'center'); text(label, 212, 572 + i * 70, 27, C.white); }); });
    enter(local, .6, () => { box(1220, 335, 600, 459, C.pale, 23); smallHeading('THE USER DECIDES', 1260, 400); text('One session.', 1260, 487, 51, C.ink, 600); text('Clear permission.', 1260, 552, 43, C.green, 600); wrap('The remote agent cannot enable auto mode. Raw live channels require continuing I/O permission.', 1260, 638, 505, 28); });
  } else if (index === 4) {
    const nodes = [{ x: 100, label: 'YOUR AGENT', detail: 'Local MCP bridge' }, { x: 750, label: 'RELAY', detail: 'Ciphertext only' }, { x: 1400, label: 'USER PROBE', detail: 'Computer / USB / LAN' }];
    packet(535, 750, 515, local); packet(1185, 1400, 515, local + .5);
    nodes.forEach((node, i) => enter(local, .1 + i * .15, () => { box(node.x, 358, 435, 308, i === 1 ? C.pale : C.panel, 24); text(node.label, node.x + 217, 455, 32, i === 1 ? C.green : C.lime, 600, true, 'center'); text(i === 1 ? '◇' : '›_', node.x + 217, 537, 57, i === 1 ? C.green : C.white, 500, true, 'center'); text(node.detail, node.x + 217, 610, 25, i === 1 ? C.muted : C.dim, 500, false, 'center'); }));
    enter(local, 1.2, () => { wrap('The relay cannot read commands or results. It can see IP addresses, timing, and traffic volume.', 170, 737, 1590, 28, C.muted); });
    enter(local, 2.4, () => { text('The diagnostician and their AI provider can read results.', 960, 825, 29, C.green, 500, false, 'center'); });
  } else if (index === 5) {
    enter(local, .05, () => { terminal(100, 335, 775, 470, 'READ-ONLY INVESTIGATION · EXAMPLE'); const rows = ['Application cannot reach local service', 'Collect logs + inspect configuration', 'Service is listening on port 8080', 'Application is configured for 8081']; rows.forEach((row, i) => enter(local, .6 + i * .7, () => { text(String(i + 1).padStart(2, '0'), 140, 446 + i * 80, 22, C.dim, 500, true); wrap(row, 195, 446 + i * 80, 630, 26, i === 3 ? C.amber : C.white, 1.2); })); });
    enter(local, 2.8, () => { box(930, 335, 890, 470, C.pale, 24); smallHeading('PROPOSED REPAIR · EXAMPLE', 970, 398); text('Change one port.', 970, 486, 52, C.ink, 600); pill('8081 → 8080', 970, 524, 278); wrap('Explain the impact. Preserve the original setting where practical. Apply only authorized changes.', 970, 624, 797, 30); text('Then repeat the original failing check.', 970, 755, 28, C.green); });
  } else if (index === 6) {
    enter(local, .05, () => { terminal(100, 335, 920, 467, 'AUTHORIZED REPAIR · ILLUSTRATIVE'); const rows = [['Approved target', 'Application configuration'], ['Before', 'service_port = 8081'], ['After', 'service_port = 8080']]; rows.forEach(([label, value], i) => { text(label, 140, 449 + i * 91, 22, C.dim); if (i < 2 || local > 1.2) text(value, 140, 487 + i * 91, 31, i === 2 ? C.lime : C.white, 500, true); }); if (local > 2.2) { tick(160, 754, C.lime); text('Guarded write · before/after hashes', 195, 764, 25, C.dim); } });
    enter(local, .5, () => { const labels = ['COMMANDS & SCRIPTS', 'LIVE PTY / STDIN', 'FILES & TRANSFERS', 'TCP / SOCKS5', 'USB / SERIAL']; labels.forEach((label, i) => { box(1090, 335 + i * 96, 730, 77, i % 2 === 0 ? C.pale : '#edf0e4', 12); text(label, 1120, 383 + i * 96, 26, C.green, 500, true); tick(1770, 374 + i * 96, C.green, .7); }); });
  } else if (index === 7) {
    enter(local, .05, () => { box(100, 335, 1000, 470, C.pale, 24); smallHeading('REPEAT THE ORIGINAL CHECK · EXAMPLE', 140, 400); text('Can the application', 140, 493, 53, C.ink, 600); text('reach the service now?', 140, 559, 53, C.ink, 600); if (local > .8) { circle(167, 652, 29, C.green); tick(167, 652, C.lime, 1.1); text('Connection successful', 220, 665, 38, C.green, 600); } wrap('Report what changed, the test result, and anything still unresolved.', 140, 748, 895, 27); });
    enter(local, .4, () => { terminal(1160, 335, 660, 470, 'LOCAL AUDIT TRAIL · EXAMPLE'); const rows = ['Approval decision', 'Operation + target', 'File change hashes', 'Bytes collected / sent', 'Outcome']; rows.forEach((row, i) => enter(local, .9 + i * .45, () => { tick(1210, 443 + i * 65, C.lime, .65); text(row, 1245, 454 + i * 65, 27, C.white); })); });
  } else if (index === 8) {
    enter(local, .05, () => { smallHeading('OPEN SOURCE. HUMAN PERMISSION.', 100, 224); text('Diagnose and fix.', 100, 367, 101, C.ink, 600); text('With your AI agent.', 100, 484, 92, C.green, 500); text('npx @masstensor/diagnose@latest agent codex', 105, 600, 29, C.ink, 500, true); text('diagnose.fenginwind.com', 105, 691, 32, C.green); });
    enter(local, .3, () => { terminal(1270, 255, 550, 460, "USER'S LOCAL CONTROLS"); command('> permissions ask', 1310, 410, local, .6, 28); text('Revoke automatic permissions', 1310, 465, 25, C.dim); command('> Ctrl+C', 1310, 561, local, 1.4, 32); text('End the probe', 1310, 614, 26, C.dim); });
    enter(local, .6, () => { pill('MIT LICENSE', 1300, 747, 215); pill('USER CONTROL', 1535, 747, 255); });
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
