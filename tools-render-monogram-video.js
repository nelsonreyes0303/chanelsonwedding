/* Renders the monogram on its own to an mp4.
 *
 * The animation is never left to play on its own: every frame is a deliberate
 * seek of the document's animations to an exact time, so the output is the
 * same on any machine and never drops or doubles a frame. Frames go straight
 * down a pipe into ffmpeg rather than onto disk.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const ffmpeg = require('ffmpeg-static');

const SCRATCH = path.resolve(__dirname, '..').replace(/\\/g, '/');
const OUT = 'C:/Personal/chanelsonwedding/monogram.mp4';

const W = 1920, H = 1080, FPS = 30, LOOP = 14;      // seconds
const FRAMES = LOOP * FPS;

/* ----------------------------------------------------- the page to record */
const ds = JSON.parse(fs.readFileSync(SCRATCH + '/monogram-paths.json', 'utf8'));
const strokes = ds.map((d, i) => `    <path class="ink" d="${d}"/>`).join('\n');

const page = `<!doctype html><html><head><meta charset="utf-8"><title>m</title>
<style>
:root{--ease:cubic-bezier(.22,.68,.16,1)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#14170d}
.stage{position:relative;width:${W}px;height:${H}px;display:grid;place-items:center;overflow:hidden;
  background:radial-gradient(120% 90% at 50% 46%, #333a21 0%, #20240f 46%, #14170d 100%)}
.stage::before{content:'';position:absolute;inset:-20%;
  background:radial-gradient(34% 34% at 50% 50%, rgba(176,141,87,.26), transparent 70%);
  opacity:0;animation:bloom ${LOOP}s var(--ease) infinite}
.stage::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(100% 76% at 50% 50%, transparent 54%, rgba(0,0,0,.6) 100%)}
.mono{position:relative;z-index:2;width:${Math.round(H * 0.72)}px;height:${Math.round(H * 0.72)}px;overflow:visible}
.ink{fill:none;stroke:#EADCBE;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;opacity:0}
.body{opacity:0;animation:bodyIn ${LOOP}s var(--ease) infinite}
.halo{opacity:0;animation:haloIn ${LOOP}s ease-in-out infinite}
.sheen{opacity:0;animation:sheenIn ${LOOP}s linear infinite}
.motes{position:absolute;inset:0;z-index:1}
.motes i{position:absolute;display:block;border-radius:50%;background:#CDAE7C;opacity:0;animation:drift linear infinite}

@keyframes bloom{0%{opacity:0}10%{opacity:.6}70%{opacity:.85}86%{opacity:.6}97%,100%{opacity:0}}
@keyframes drawIn{
  0%,2%{opacity:0;stroke-dashoffset:var(--len)}
  6%{opacity:.95}
  30%{opacity:.95;stroke-dashoffset:0}
  38%{opacity:0;stroke-dashoffset:0}
  100%{opacity:0;stroke-dashoffset:0}}
@keyframes bodyIn{0%,24%{opacity:0}36%{opacity:1}88%{opacity:1}97%,100%{opacity:0}}
@keyframes haloIn{0%,27%{opacity:0}38%{opacity:.8}56%{opacity:.4}72%{opacity:.75}88%{opacity:.45}97%,100%{opacity:0}}
@keyframes sheenIn{
  0%,37%{opacity:0;transform:translateX(-130%) skewX(-14deg)}
  39%{opacity:.85}
  52%{opacity:.85}
  55%{opacity:0;transform:translateX(130%) skewX(-14deg)}
  100%{opacity:0;transform:translateX(130%) skewX(-14deg)}}
@keyframes drift{0%{opacity:0;transform:translate3d(0,0,0)}12%{opacity:.5}80%{opacity:.35}100%{opacity:0;transform:translate3d(var(--dx),var(--dy),0)}}
</style></head><body>
<div class="stage" id="stage">
  <div class="motes" id="motes"></div>
  <svg class="mono" viewBox="0 0 1000 1000">
    <defs>
      <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#9C7A45"/><stop offset=".32" stop-color="#CDAE7C"/>
        <stop offset=".5" stop-color="#EFE0C0"/><stop offset=".68" stop-color="#CDAE7C"/>
        <stop offset="1" stop-color="#9C7A45"/></linearGradient>
      <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".45" stop-color="#fff" stop-opacity=".85"/>
        <stop offset=".55" stop-color="#fff" stop-opacity=".85"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="13" result="b"/>
        <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .85 0"/></filter>
      <clipPath id="shape" clipPathUnits="userSpaceOnUse"><path fill-rule="evenodd" d="${ds.join(' ')}"/></clipPath>
    </defs>
    <path class="halo" fill="#C9A253" fill-rule="evenodd" filter="url(#glow)" d="${ds.join(' ')}"/>
    <path class="body" fill="url(#leaf)" fill-rule="evenodd" d="${ds.join(' ')}"/>
    <g clip-path="url(#shape)">
      <rect class="sheen" x="-420" y="-120" width="640" height="1260" fill="url(#sweep)"/>
    </g>
    <g>
${strokes}
    </g>
  </svg>
</div>
<script>
var inks = [].slice.call(document.querySelectorAll('.ink'));
inks.forEach(function (p, i) {
  var len = p.getTotalLength();
  p.style.setProperty('--len', len);
  p.style.strokeDasharray = len;
  p.style.strokeDashoffset = len;
  p.style.animation = 'drawIn ${LOOP}s cubic-bezier(.22,.68,.16,1) infinite';
  p.style.animationDelay = (i * 0.2) + 's';
});
/* seeded so the motes land in the same places every render */
var seed = 20261206;
function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
var motes = document.getElementById('motes');
for (var i = 0; i < 18; i++) {
  var m = document.createElement('i');
  var s = 2 + rnd() * 4.5;
  m.style.width = m.style.height = s.toFixed(1) + 'px';
  m.style.left = (rnd() * 100).toFixed(2) + '%';
  m.style.top = (55 + rnd() * 50).toFixed(2) + '%';
  m.style.setProperty('--dx', (rnd() * 90 - 45).toFixed(0) + 'px');
  m.style.setProperty('--dy', (-300 - rnd() * 420).toFixed(0) + 'px');
  m.style.animationDuration = (14 + rnd() * 16).toFixed(1) + 's';
  m.style.animationDelay = (-rnd() * 26).toFixed(1) + 's';
  motes.appendChild(m);
}
window.__ready = true;
</script></body></html>`;

const pagePath = SCRATCH + '/render/frame-page.html';
fs.writeFileSync(pagePath, page);

/* --------------------------------------------------------------- recording */
(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-device-scale-factor=1', '--hide-scrollbars',
           '--disable-lcd-text', '--font-render-hinting=none']
  });
  const tab = await browser.newPage();
  await tab.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await tab.goto('file:///' + pagePath, { waitUntil: 'load' });
  await tab.waitForFunction('window.__ready === true');

  // freeze everything; from here each frame is an explicit seek
  await tab.evaluate(() => {
    document.getAnimations().forEach(a => { a.pause(); });
  });

  const enc = spawn(ffmpeg, [
    '-y',
    '-f', 'image2pipe', '-c:v', 'png', '-r', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-pix_fmt', 'yuv420p',                 // the format every player expects
    '-movflags', '+faststart',
    '-r', String(FPS),
    OUT
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  enc.stderr.on('data', d => { ffErr += d.toString(); });

  const done = new Promise((res, rej) => {
    enc.on('close', code => code === 0 ? res() : rej(new Error('ffmpeg exit ' + code + '\n' + ffErr.slice(-1500))));
  });

  const t0 = Date.now();
  for (let f = 0; f < FRAMES; f++) {
    const ms = (f / FPS) * 1000;
    await tab.evaluate((t) => {
      document.getAnimations().forEach(a => { try { a.currentTime = t; } catch (e) {} });
    }, ms);
    const buf = await tab.screenshot({ type: 'png', optimizeForSpeed: true });
    if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
    if (f % 30 === 0) {
      process.stdout.write('  frame ' + f + '/' + FRAMES +
        '  (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');
    }
  }
  enc.stdin.end();
  await done;
  await browser.close();

  const kb = fs.statSync(OUT).size / 1024;
  console.log('wrote ' + OUT);
  console.log(FRAMES + ' frames  ' + W + 'x' + H + '  ' + FPS + 'fps  ' +
    LOOP + 's  ' + (kb / 1024).toFixed(2) + ' MB  in ' +
    ((Date.now() - t0) / 1000).toFixed(0) + 's');
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
