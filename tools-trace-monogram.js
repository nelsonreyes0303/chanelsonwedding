/* Trace the monogram by iso-contouring its alpha channel at 0.5 rather than
   outlining a hard mask. The PNG is anti-aliased, so the edge sits between
   pixels; interpolating to find where it crosses recovers that sub-pixel
   position and the curves come out smooth instead of stair-stepped. */
const fs = require('fs');
const zlib = require('zlib');

const HERE = __dirname.replace(/\\/g, '/') + '/';
const SRC = 'C:/Personal/chanelsonwedding/img/monogram-gold.png';

/* ----------------------------------------------------------- PNG decoding */
function decode(file) {
  const b = fs.readFileSync(file);
  let p = 8, idat = [], w = 0, h = 0;
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('expected 8-bit RGBA');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    const line = raw.slice(o, o + stride); o += stride;
    const cur = px.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, bb = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += bb;
      else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) {
        const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, px, stride };
}

const img = decode(SRC);

/* alpha as a scalar field, with a one-pixel empty border so shapes that run
   to the edge still close */
const PAD = 1;
const W = img.w + PAD * 2, H = img.h + PAD * 2;
const A = new Float32Array(W * H);
for (let y = 0; y < img.h; y++)
  for (let x = 0; x < img.w; x++)
    A[(y + PAD) * W + (x + PAD)] = img.px[y * img.stride + x * 4 + 3] / 255;

const ISO = 0.5;
const val = (x, y) => A[y * W + x];
const inside = (x, y) => val(x, y) >= ISO;

/* Where the contour crosses a grid edge, keyed by the edge itself so the two
   cells that share it agree exactly rather than by rounded coordinates. */
const pos = new Map();
function hKey(x, y) {                       // between (x,y) and (x+1,y)
  const k = 'H' + x + ',' + y;
  if (!pos.has(k)) {
    const a = val(x, y), b = val(x + 1, y);
    pos.set(k, [x + (ISO - a) / (b - a), y]);
  }
  return k;
}
function vKey(x, y) {                       // between (x,y) and (x,y+1)
  const k = 'V' + x + ',' + y;
  if (!pos.has(k)) {
    const a = val(x, y), b = val(x, y + 1);
    pos.set(k, [x, y + (ISO - a) / (b - a)]);
  }
  return k;
}

/* ------------------------------------------------------- marching squares */
const adj = new Map();
const link = (a, b) => {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push(b); adj.get(b).push(a);
};

for (let y = 0; y < H - 1; y++) {
  for (let x = 0; x < W - 1; x++) {
    const a = inside(x, y), b = inside(x + 1, y), c = inside(x + 1, y + 1), d = inside(x, y + 1);
    const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const T = () => hKey(x, y), B = () => hKey(x, y + 1),
          L = () => vKey(x, y), R = () => vKey(x + 1, y);
    switch (code) {
      case 1: case 14: link(L(), T()); break;
      case 2: case 13: link(T(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(R(), B()); break;
      case 6: case 9:  link(T(), B()); break;
      case 7: case 8:  link(L(), B()); break;
      case 5: case 10: {
        // saddle: the cell's average decides which way the two strands pass
        const mid = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4;
        const joined = code === 5 ? mid >= ISO : mid < ISO;
        if (joined) { link(L(), T()); link(R(), B()); }
        else { link(T(), R()); link(L(), B()); }
        break;
      }
    }
  }
}

/* ------------------------------------------------- stitch links into loops
   Every crossing joins exactly two neighbours, so walking from any unused
   node and always taking the neighbour we did not arrive from closes a ring.
   Winding is irrelevant here: the paths are filled with fill-rule evenodd. */
const used = new Set();
const rings = [];
for (const start of adj.keys()) {
  if (used.has(start)) continue;
  const ring = [];
  let cur = start, prev = null, guard = 0;
  while (cur && !used.has(cur)) {
    used.add(cur);
    ring.push(pos.get(cur));
    const ns = adj.get(cur) || [];
    let next = null;
    for (const n of ns) if (n !== prev && !used.has(n)) { next = n; break; }
    prev = cur; cur = next;
    if (++guard > W * H * 4) break;
  }
  if (ring.length > 8) rings.push(ring);
}

/* ------------------------------------------------------------- simplifying */
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
    if (d > max) { max = d; idx = i; }
  }
  if (max > eps) return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  return [pts[0], pts[pts.length - 1]];
}

/* A ring has to be cut before it is simplified: with the first and last point
   in the same place the baseline has no length and the whole thing collapses. */
function rdpRing(pts, eps) {
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function area(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s / 2);
}

/* Catmull-Rom through the simplified points, written out as cubic beziers so
   the curve stays smooth at any projector size. */
const SCALE = 1000 / img.w;
const f = (v) => +((v - PAD) * SCALE).toFixed(2);

function toPath(pts) {
  const s = rdpRing(pts, 0.18);
  if (s.length < 4) return null;
  const n = s.length;
  let d = 'M' + f(s[0][0]) + ' ' + f(s[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = s[(i - 1 + n) % n], p1 = s[i], p2 = s[(i + 1) % n], p3 = s[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += 'C' + f(c1x) + ' ' + f(c1y) + ',' + f(c2x) + ' ' + f(c2y) + ',' + f(p2[0]) + ' ' + f(p2[1]);
  }
  return d + 'Z';
}

const kept = rings.filter(r => area(r) > 1.2).sort((a, b) => area(b) - area(a));
const ds = kept.map(toPath).filter(Boolean);

console.log('rings: ' + rings.length + '  kept: ' + ds.length +
  '  points: ' + kept.map(r => r.length).slice(0, 8).join(', '));

fs.writeFileSync(HERE + 'monogram-paths.json', JSON.stringify(ds, null, 1));
fs.writeFileSync(HERE + 'trace-preview.svg',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="500" height="500">' +
  '<rect width="1000" height="1000" fill="#252816"/>' +
  '<path fill="#CDAE7C" fill-rule="evenodd" d="' + ds.join(' ') + '"/></svg>');
console.log('wrote monogram-paths.json + trace-preview.svg (' +
  (ds.join(' ').length / 1024).toFixed(1) + ' KB of path data)');
