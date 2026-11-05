/* Assembles monogram.html: one self-contained file with the traced monogram
   and the fonts inlined, so it plays off a laptop at the venue with no
   internet and nothing else to copy alongside it. */
const fs = require('fs');
const HERE = __dirname.replace(/\\/g, '/') + '/';

const ds = JSON.parse(fs.readFileSync(HERE + 'monogram-paths.json', 'utf8'));
const faces = JSON.parse(fs.readFileSync(HERE + 'faces.json', 'utf8'))
  .filter(f => !(f.family === 'Cormorant Garamond' && f.weight === '500'))
  .filter(f => !(f.family === 'Jost' && f.weight === '400'));

const fontCss = faces.map(f =>
  `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:block;` +
  `src:url(data:font/woff2;base64,${f.b64}) format('woff2')}`).join('\n');

const strokes = ds.map((d, i) =>
  `    <path class="ink" id="ink${i}" d="${d}"/>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nelson &amp; Chanel</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<style>
${fontCss}

:root{
  --ink:#14170d; --deep:#1B1E10; --mid:#252816;
  --gold:#B08D57; --gold-lt:#CDAE7C; --gold-pale:#EADCBE; --cream:#F7F1E7;
  --script:'Pinyon Script','Apple Chancery',cursive;
  --serif:'Cormorant Garamond','Iowan Old Style',Georgia,serif;
  --sans:'Jost','Avenir Next','Helvetica Neue',Arial,sans-serif;
  --ease:cubic-bezier(.22,.68,.16,1);
  /* one knob for the whole piece, so the timeline below stays readable */
  --beat:1s;
}

*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  background:var(--ink);
  color:var(--cream);
  overflow:hidden;
  display:grid;
  place-items:center;
  cursor:none;
}
body.showcursor{cursor:default}

/* The stage keeps a 16:9 shape and scales as one piece, so every size below
   can be written in cqh and the whole thing tracks the projector. */
.stage{
  position:relative;
  width:100vw; height:100vh;
  container-type:size;
  display:grid; place-items:center;
  overflow:hidden;
  background:
    radial-gradient(120% 90% at 50% 42%, #30361f 0%, #20240f 45%, var(--ink) 100%);
}
/* a slow warm bloom behind everything */
.stage::before{
  content:'';position:absolute;inset:-20%;
  background:radial-gradient(38% 38% at 50% 44%, rgba(176,141,87,.22), transparent 70%);
  opacity:0; animation:bloom var(--loop) var(--ease) infinite;
}
/* vignette, keeps the corners off a bright projector */
.stage::after{
  content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(100% 75% at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%);
}

.piece{position:relative;display:grid;place-items:center;gap:0;z-index:2}

/* ------------------------------------------------------------- monogram */
.mono{width:auto;height:54cqh;display:block;overflow:visible}

.ink{
  fill:none;
  stroke:var(--gold-pale);
  stroke-width:3.2;
  stroke-linecap:round;
  stroke-linejoin:round;
  opacity:0;
}
.mono .body{opacity:0;animation:bodyIn var(--loop) var(--ease) infinite}
.mono .halo{opacity:0;animation:haloIn var(--loop) ease-in-out infinite}

/* the sweep that travels over the gold once it has filled in */
.sheen{opacity:0;animation:sheenIn var(--loop) linear infinite}

/* ---------------------------------------------------------------- words */
.names{
  font-family:var(--script);font-weight:400;font-synthesis:none;
  font-size:10.5cqh;line-height:1.05;
  color:var(--gold-lt);
  margin-top:2.2cqh;
  text-shadow:0 0 .35em rgba(176,141,87,.35);
  opacity:0;animation:riseIn var(--loop) var(--ease) infinite;
}
.rule{
  display:flex;align-items:center;justify-content:center;gap:1.4cqh;
  margin-top:2.4cqh;width:30cqh;
  opacity:0;animation:ruleIn var(--loop) var(--ease) infinite;
}
.rule i{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(205,174,124,.95),transparent)}
.rule b{
  width:.95cqh;height:.95cqh;background:var(--gold-lt);transform:rotate(45deg);
  flex:none;
}
.date{
  font-family:var(--sans);font-weight:300;
  font-size:1.9cqh;letter-spacing:.42em;text-transform:uppercase;
  color:rgba(247,241,231,.72);
  margin-top:2.3cqh;padding-left:.42em;
  opacity:0;animation:dateIn var(--loop) var(--ease) infinite;
}
.place{
  font-family:var(--sans);font-weight:300;
  font-size:1.35cqh;letter-spacing:.38em;text-transform:uppercase;
  color:rgba(247,241,231,.4);
  margin-top:1.1cqh;padding-left:.38em;
  opacity:0;animation:dateIn var(--loop) var(--ease) infinite;
  animation-delay:.25s;
}

/* --------------------------------------------------------------- motes */
.motes{position:absolute;inset:0;pointer-events:none;z-index:1}
.motes i{
  position:absolute;display:block;border-radius:50%;
  background:var(--gold-lt);opacity:0;
  animation:drift linear infinite;
}

/* ----------------------------------------------------------------- hint */
.hint{
  position:fixed;left:0;right:0;bottom:3.2cqh;text-align:center;z-index:5;
  font-family:var(--sans);font-weight:300;font-size:1.2cqh;
  letter-spacing:.3em;text-transform:uppercase;color:rgba(247,241,231,.3);
  animation:hintOut 7s var(--ease) forwards;
}
body.showcursor .hint{animation:none;opacity:.45}

/* ============================== timeline ==============================
   Every animation runs the same --loop duration and carves its slice out
   with percentages, which keeps them locked together no matter how long
   the loop is set to. At 22s one percent is 0.22s. */
@keyframes bloom{
   0%   {opacity:0}
   8%   {opacity:.55}
  72%   {opacity:.8}
  88%   {opacity:.55}
  97%,100%{opacity:0}
}
@keyframes drawIn{            /* per-path, offset set from JS */
   0%,2%  {opacity:0;stroke-dashoffset:var(--len)}
   5%     {opacity:.95}
  21%     {opacity:.95;stroke-dashoffset:0}
  27%     {opacity:0;stroke-dashoffset:0}
 100%     {opacity:0;stroke-dashoffset:0}
}
@keyframes bodyIn{
   0%,17% {opacity:0}
  26%     {opacity:1}
  90%     {opacity:1}
  97%,100%{opacity:0}
}
@keyframes haloIn{
   0%,19% {opacity:0}
  28%     {opacity:.75}
  46%     {opacity:.35}
  64%     {opacity:.7}
  82%     {opacity:.35}
  90%     {opacity:.5}
  97%,100%{opacity:0}
}
@keyframes sheenIn{
   0%,26% {opacity:0;transform:translateX(-130%) skewX(-14deg)}
  28%     {opacity:.85}
  39%     {opacity:.85}
  42%     {opacity:0;transform:translateX(130%) skewX(-14deg)}
 100%     {opacity:0;transform:translateX(130%) skewX(-14deg)}
}
@keyframes riseIn{
   0%,27% {opacity:0;transform:translateY(1.6cqh)}
  36%     {opacity:1;transform:translateY(0)}
  90%     {opacity:1;transform:translateY(0)}
  97%,100%{opacity:0;transform:translateY(0)}
}
@keyframes ruleIn{
   0%,33% {opacity:0;transform:scaleX(.3)}
  41%     {opacity:1;transform:scaleX(1)}
  90%     {opacity:1;transform:scaleX(1)}
  97%,100%{opacity:0;transform:scaleX(1)}
}
@keyframes dateIn{
   0%,37% {opacity:0;transform:translateY(.8cqh)}
  45%     {opacity:1;transform:translateY(0)}
  90%     {opacity:1;transform:translateY(0)}
  97%,100%{opacity:0;transform:translateY(0)}
}
@keyframes drift{
   0%  {opacity:0;transform:translate3d(0,0,0)}
  12%  {opacity:.5}
  80%  {opacity:.35}
 100%  {opacity:0;transform:translate3d(var(--dx),var(--dy),0)}
}
@keyframes hintOut{ 0%,55%{opacity:.3} 100%{opacity:0} }

@media (prefers-reduced-motion:reduce){
  .stage::before,.mono .body,.mono .halo,.sheen,.names,.rule,.date,.place{
    animation:none;opacity:1;transform:none}
  .ink{display:none}
  .motes{display:none}
}
</style>
</head>
<body>
<div class="stage" id="stage" style="--loop:22s">
  <div class="motes" id="motes"></div>

  <div class="piece">
    <svg class="mono" viewBox="0 0 1000 1000" aria-label="C V monogram">
      <defs>
        <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0"   stop-color="#9C7A45"/>
          <stop offset=".32" stop-color="#CDAE7C"/>
          <stop offset=".5"  stop-color="#EFE0C0"/>
          <stop offset=".68" stop-color="#CDAE7C"/>
          <stop offset="1"   stop-color="#9C7A45"/>
        </linearGradient>
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0"   stop-color="#fff" stop-opacity="0"/>
          <stop offset=".45" stop-color="#fff" stop-opacity=".85"/>
          <stop offset=".55" stop-color="#fff" stop-opacity=".85"/>
          <stop offset="1"   stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="14" result="b"/>
          <feColorMatrix in="b" type="matrix" values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 .85 0"/>
        </filter>
        <clipPath id="shape" clipPathUnits="userSpaceOnUse">
          <path fill-rule="evenodd" d="${ds.join(' ')}"/>
        </clipPath>
      </defs>

      <!-- the bloom that sits under the gold -->
      <path class="halo" fill="#C9A253" fill-rule="evenodd" filter="url(#glow)"
            d="${ds.join(' ')}"/>
      <!-- the monogram itself -->
      <path class="body" fill="url(#leaf)" fill-rule="evenodd"
            d="${ds.join(' ')}"/>
      <!-- the light that travels across it once -->
      <g clip-path="url(#shape)">
        <rect class="sheen" x="-420" y="-120" width="640" height="1260"
              fill="url(#sweep)"/>
      </g>
      <!-- the outline, written on first and then handed over to the fill -->
      <g id="inks">
${strokes}
      </g>
    </svg>

    <div class="names">Nelson &amp; Chanel</div>
    <div class="rule"><i></i><b></b><i></i></div>
    <div class="date">Sunday, the sixth of December</div>
    <div class="place">Two thousand and twenty-six &nbsp;&middot;&nbsp; Quezon City</div>
  </div>

  <div class="hint" id="hint">F &nbsp;fullscreen &nbsp;&middot;&nbsp; Space &nbsp;replay &nbsp;&middot;&nbsp; &larr; &rarr; &nbsp;speed</div>
</div>

<script>
(function () {
  var stage = document.getElementById('stage');

  /* Each outline is dashed by its own length so the stroke writes itself,
     and started a beat after the one before. getTotalLength is measured
     rather than guessed, so it holds whatever the path data turns out to be. */
  var inks = Array.prototype.slice.call(document.querySelectorAll('.ink'));
  function arm() {
    var loop = parseFloat(getComputedStyle(stage).getPropertyValue('--loop')) || 22;
    inks.forEach(function (p, i) {
      var len = p.getTotalLength();
      p.style.setProperty('--len', len);
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      p.style.animation = 'drawIn ' + loop + 's cubic-bezier(.22,.68,.16,1) infinite';
      p.style.animationDelay = (-0 + i * 0.26) + 's';
    });
  }
  arm();

  /* A scatter of slow motes. Positions are random once, on load, so the
     drift never repeats exactly the way a hand-written set would. */
  var motes = document.getElementById('motes');
  for (var i = 0; i < 16; i++) {
    var m = document.createElement('i');
    var s = 1.5 + Math.random() * 3.5;
    m.style.width = m.style.height = s.toFixed(1) + 'px';
    m.style.left = (Math.random() * 100).toFixed(2) + '%';
    m.style.top = (55 + Math.random() * 50).toFixed(2) + '%';
    m.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(0) + 'px');
    m.style.setProperty('--dy', (-220 - Math.random() * 320).toFixed(0) + 'px');
    m.style.animationDuration = (16 + Math.random() * 18).toFixed(1) + 's';
    m.style.animationDelay = (-Math.random() * 26).toFixed(1) + 's';
    motes.appendChild(m);
  }

  /* restart every animation on the stage from the top */
  function replay() {
    var p = stage.parentNode, n = stage.nextSibling;
    p.removeChild(stage); void stage.offsetWidth; p.insertBefore(stage, n);
    arm();
  }

  function setLoop(sec) {
    sec = Math.max(10, Math.min(60, sec));
    stage.style.setProperty('--loop', sec + 's');
    replay();
  }

  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(function () {});
    } else if (k === ' ' || k === 'r') {
      e.preventDefault(); replay();
    } else if (k === 'arrowleft') {
      setLoop(parseFloat(getComputedStyle(stage).getPropertyValue('--loop')) + 2);
    } else if (k === 'arrowright') {
      setLoop(parseFloat(getComputedStyle(stage).getPropertyValue('--loop')) - 2);
    }
  });

  /* the cursor goes away on its own, which is what you want pointed at a wall */
  var idle;
  document.addEventListener('mousemove', function () {
    document.body.classList.add('showcursor');
    clearTimeout(idle);
    idle = setTimeout(function () { document.body.classList.remove('showcursor'); }, 2500);
  });
})();
</script>
</body>
</html>`;

fs.writeFileSync('C:/Personal/chanelsonwedding/monogram.html', html);
console.log('monogram.html written: ' + (html.length / 1024).toFixed(1) + ' KB' +
  '  (' + ds.length + ' outlines, ' + faces.length + ' fonts inlined)');
