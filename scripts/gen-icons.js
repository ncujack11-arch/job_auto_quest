// 图标生成脚本:零依赖生成扩展所需 PNG 图标(16/32/48/128)
// 运行: node scripts/gen-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const ck = Buffer.alloc(4);
  ck.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, ck]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [37, 99, 235, 255];     // #2563EB
const WHITE = [255, 255, 255, 255];
const GREEN = [34, 197, 94, 255];  // #22C55E
const DARK = [30, 58, 138, 255];   // #1E3A8A

function inRoundRect(x, y, s, r) {
  const cx = Math.max(r, Math.min(s - r, x));
  const cy = Math.max(r, Math.min(s - r, y));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function dist(x0, y0, x1, y1) { return Math.hypot(x0 - x1, y0 - y1); }

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  // 圆角矩形底色
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside;
      if (x < r && y < r) inside = inRoundRect(x + 0.5, y + 0.5, size, r);
      else if (x > size - r && y < r) inside = inRoundRect(x + 0.5, y + 0.5, size, r);
      else if (x < r && y > size - r) inside = inRoundRect(x + 0.5, y + 0.5, size, r);
      else if (x > size - r && y > size - r) inside = inRoundRect(x + 0.5, y + 0.5, size, r);
      else inside = true;
      const i = (y * size + x) * 4;
      if (inside) { px[i] = BG[0]; px[i + 1] = BG[1]; px[i + 2] = BG[2]; px[i + 3] = BG[3]; }
      else { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; }
    }
  }
  // 三条白色表单线(模拟文本行)
  const barW = size * 0.56, barH = Math.max(1, size * 0.07);
  const bx = size * 0.22;
  const barYs = [size * 0.26, size * 0.44, size * 0.62];
  for (const by of barYs) {
    for (let y = Math.round(by); y < Math.round(by + barH); y++) {
      for (let x = Math.round(bx); x < Math.round(bx + barW); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const i = (y * size + x) * 4;
        if (px[i + 3] === 0) continue;
        px[i] = WHITE[0]; px[i + 1] = WHITE[1]; px[i + 2] = WHITE[2]; px[i + 3] = WHITE[3];
      }
    }
  }
  // 右下角绿色勾选圆点
  const cSize = size * 0.3;
  const cX = size - cSize * 0.72, cY = size - cSize * 0.72;
  for (let y = Math.max(0, Math.round(cY - cSize / 2)); y < Math.min(size, Math.round(cY + cSize / 2)); y++) {
    for (let x = Math.max(0, Math.round(cX - cSize / 2)); x < Math.min(size, Math.round(cX + cSize / 2)); x++) {
      if (dist(x + 0.5, y + 0.5, cX, cY) <= cSize / 2) {
        const i = (y * size + x) * 4;
        if (px[i + 3] === 0) continue;
        px[i] = GREEN[0]; px[i + 1] = GREEN[1]; px[i + 2] = GREEN[2]; px[i + 3] = GREEN[3];
      }
    }
  }
  // 圆点内的白色勾
  if (size >= 32) {
    const s = size, o = s * 0.045;
    const pts = [[cX - cSize * 0.18, cY + cSize * 0.02], [cX - cSize * 0.03, cY - cSize * 0.18], [cX + cSize * 0.22, cY + cSize * 0.2]];
    const segs = [[pts[0], pts[1]], [pts[1], pts[2]]];
    for (const [a, b] of segs) {
      const steps = Math.ceil(dist(a[0], a[1], b[0], b[1]) / 0.7);
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(a[0] + (b[0] - a[0]) * (t / steps));
        const y = Math.round(a[1] + (b[1] - a[1]) * (t / steps));
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= s || yy >= s) continue;
          const i = (yy * s + xx) * 4;
          if (px[i + 3] === 0) continue;
          px[i] = DARK[0]; px[i + 1] = DARK[1]; px[i + 2] = DARK[2]; px[i + 3] = DARK[3];
        }
      }
    }
  }
  return encodePNG(size, size, px);
}

const outDir = path.join(__dirname, '..', 'src', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), render(s));
  console.log('generated icon' + s + '.png');
}
