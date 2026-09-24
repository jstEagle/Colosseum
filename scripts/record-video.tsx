/**
 * Record a replay as a video, for sharing.
 *
 *   npx tsx scripts/record-video.tsx <replay-id|latest> [out.mp4]
 *
 * Three stages, all deterministic:
 *   1. The real app plays the replay (countdown, fight, verdict) into a
 *      virtual terminal, and every byte it draws is logged with its time.
 *   2. Headless Chrome renders that log with xterm.js, frame by frame at
 *      30fps — the arena exactly as a terminal shows it, at 1920×1080.
 *   3. ffmpeg stitches the frames into an H.264 MP4.
 *
 * Needs Google Chrome and ffmpeg. Chrome loads xterm.js and the font from
 * a CDN, so it needs the network.
 */
// scripts/ sits outside tsconfig's include, so JSX here is the classic kind.
import React from 'react';
import { PassThrough } from 'node:stream';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const COLS = 184;
const ROWS = 50;
const FPS = 30;
/** Seconds the verdict stays on screen once it appears. */
const HOLD = 7;

const [id = 'latest', outArg = 'colosseum-fight.mp4'] = process.argv.slice(2);
const out = resolve(outArg);
process.env.FORCE_COLOR = '3';

/* ----------------------------------------------------------- 1. capture -- */

async function capture(): Promise<{ t: number; d: string }[]> {
  const [{ render }, { App }, { loadReplay }] = await Promise.all([
    import('ink'),
    import('../src/app.js'),
    import('../src/replays.js'),
  ]);
  const replay = loadReplay(id);
  if (!replay) throw new Error(`no replay "${id}"`);
  const chunks: { t: number; d: string }[] = [];
  const t0 = Date.now();

  const stdout = new PassThrough() as any;
  Object.assign(stdout, { columns: COLS, rows: ROWS, isTTY: true });
  stdout.write = (d: string | Buffer) => {
    chunks.push({ t: Date.now() - t0, d: d.toString() });
    return true;
  };
  const stdin = new PassThrough() as any;
  Object.assign(stdin, { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });

  const { unmount } = render(<App replayId={replay.id} intro />, {
    stdout,
    stdin,
    stderr: stdout,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  // Countdown ~3.2s, the fight at 2×, the verdict's pause, then the hold.
  const seconds = 3.5 + (replay.record?.durationMs ?? 60_000) / 2000 + 1.5 + HOLD;
  process.stdout.write(`capturing ${replay.id}: ${seconds.toFixed(0)}s of arena…\n`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  unmount();
  return chunks.filter((c) => c.t <= seconds * 1000);
}

/* ------------------------------------------------------------ 2. render -- */

function player(chunks: { t: number; d: string }[]) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,700;1,400&display=block">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<style>html,body{margin:0;width:1920px;height:1080px;background:#0a0a0b;overflow:hidden}canvas{display:block}</style>
</head><body><canvas id="c" width="1920" height="1080"></canvas><script>
const CHUNKS = ${JSON.stringify(chunks)};
const COLS = ${COLS}, ROWS = ${ROWS};
// xterm.js only emulates here; the screen is drawn by hand below, so Braille
// can be drawn as dots the way a terminal like Ghostty draws it, not as a
// font's glyphs.
const CW = 10, CH = 20, FONT = 16.4;
const OX = Math.round((1920 - COLS * CW) / 2), OY = Math.round((1080 - ROWS * CH) / 2);
const BG = '#0a0a0b', FG = '#c9c9d0';
const PALETTE = (() => {
  const p = [];
  const base = ['#000','#c33','#3c3','#cc3','#33c','#c3c','#3cc','#ccc','#666','#f66','#6f6','#ff6','#66f','#f6f','#6ff','#fff'];
  for (const c of base) p.push(c);
  const lv = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push('rgb(' + lv[r] + ',' + lv[g] + ',' + lv[b] + ')');
  for (let i = 0; i < 24; i++) { const v = 8 + i * 10; p.push('rgb(' + v + ',' + v + ',' + v + ')'); }
  return p;
})();
let term, ctx, at = 0;
window.boot = async () => {
  await document.fonts.load(FONT + 'px "JetBrains Mono"');
  await document.fonts.load('bold ' + FONT + 'px "JetBrains Mono"');
  await document.fonts.load('italic ' + FONT + 'px "JetBrains Mono"');
  term = new Terminal({ cols: COLS, rows: ROWS, convertEol: true, allowProposedApi: true, scrollback: 0 });
  ctx = document.getElementById('c').getContext('2d');
  ctx.textBaseline = 'middle';
};
const colour = (cell, fg) => {
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return fg ? FG : null;
  const v = fg ? cell.getFgColor() : cell.getBgColor();
  if (fg ? cell.isFgRGB() : cell.isBgRGB()) return '#' + v.toString(16).padStart(6, '0');
  return PALETTE[v] || FG;
};
function draw() {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, 1920, 1080);
  const buf = term.buffer.active;
  const cell = buf.getNullCell();
  for (let y = 0; y < ROWS; y++) {
    const line = buf.getLine(buf.viewportY + y);
    if (!line) continue;
    for (let x = 0; x < COLS; x++) {
      line.getCell(x, cell);
      const ch = cell.getChars();
      if (!ch || ch === ' ') continue;
      const px = OX + x * CW, py = OY + y * CH;
      let fg = colour(cell, true);
      if (cell.isDim()) ctx.globalAlpha = 0.6;
      const code = ch.codePointAt(0);
      if (code >= 0x2800 && code <= 0x28ff) {
        // Braille: eight dots in a 2×4 grid, drawn round and full.
        const bits = code - 0x2800;
        const order = [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[0,3],[1,3]];
        ctx.fillStyle = fg;
        for (let i = 0; i < 8; i++) {
          if (!(bits & (1 << i))) continue;
          const [dx, dy] = order[i];
          ctx.beginPath();
          ctx.arc(px + CW * (dx ? 0.72 : 0.28), py + CH * (0.14 + dy * 0.24), 1.75, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = fg;
        ctx.font = (cell.isItalic() ? 'italic ' : '') + (cell.isBold() ? '700 ' : '400 ') + FONT + 'px "JetBrains Mono"';
        ctx.fillText(ch, px, py + CH / 2 + 1);
      }
      ctx.globalAlpha = 1;
    }
  }
}
// Feed everything drawn up to time ms, then paint the screen.
window.seek = (ms) => new Promise((done) => {
  let data = '';
  while (at < CHUNKS.length && CHUNKS[at].t <= ms) data += CHUNKS[at++].d;
  const paint = () => { draw(); requestAnimationFrame(() => done()); };
  if (data) term.write(data, paint); else paint();
});
</script></body></html>`;
}

async function render(chunks: { t: number; d: string }[], frames: string) {
  const html = join(frames, 'player.html');
  writeFileSync(html, player(chunks));
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=9334', '--hide-scrollbars', '--window-size=1920,1080', `--user-data-dir=${join(frames, 'profile')}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  try {
    let ws!: WebSocket;
    for (let i = 0; i < 60; i++) {
      try {
        const pages = await (await fetch('http://127.0.0.1:9334/json')).json();
        const page = pages.find((p: any) => p.type === 'page');
        if (page) {
          ws = new WebSocket(page.webSocketDebuggerUrl);
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => ws.addEventListener('open', r));
    let n = 0;
    const waiting = new Map<number, (v: any) => void>();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)!(m.result);
        waiting.delete(m.id);
      }
    });
    const send = (method: string, params: any = {}) =>
      new Promise<any>((r) => {
        const i = ++n;
        waiting.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `file://${html}` });
    await new Promise((r) => setTimeout(r, 2500));
    await send('Runtime.evaluate', { expression: 'boot()', awaitPromise: true });

    const end = chunks[chunks.length - 1].t + HOLD * 1000;
    const total = Math.ceil((end / 1000) * FPS);
    // STILLS=2000,12000 renders just those moments, to check a look quickly.
    const stills = process.env.STILLS?.split(',').map((ms) => Math.round((Number(ms) / 1000) * FPS));
    for (let f = 0; f < total; f++) {
      if (stills && !stills.includes(f)) {
        if (f > Math.max(...stills)) break;
        await send('Runtime.evaluate', { expression: `seek(${(f * 1000) / FPS})`, awaitPromise: true });
        continue;
      }
      await send('Runtime.evaluate', { expression: `seek(${(f * 1000) / FPS})`, awaitPromise: true });
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(frames, `${String(f).padStart(5, '0')}.png`), Buffer.from(data, 'base64'));
      if (f % 150 === 0) process.stdout.write(`  frame ${f}/${total}\n`);
    }
    return total;
  } finally {
    chrome.kill();
  }
}

/* ------------------------------------------------------------ 3. encode -- */

const frames = mkdtempSync(join(tmpdir(), 'colosseum-video-'));
try {
  const chunks = await capture();
  if (process.env.DUMP) {
    writeFileSync(process.env.DUMP, JSON.stringify(chunks));
    process.exit(0);
  }
  const total = await render(chunks, frames);
  if (process.env.STILLS) {
    for (const f of readdirSync(frames).filter((x) => x.endsWith('.png'))) copyFileSync(join(frames, f), `${out}-${f}`);
    process.stdout.write(`stills written next to ${out}\n`);
    process.exit(0);
  }
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, '%05d.png'),
    // Fade in from black and out to black: a clean start and end to loop or post.
    '-vf', `fade=t=in:st=0:d=0.6,fade=t=out:st=${(total / FPS - 1).toFixed(2)}:d=1`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', out,
  ]);
  process.stdout.write(`wrote ${out}\n`);
} finally {
  rmSync(frames, { recursive: true, force: true });
}
process.exit(0);
