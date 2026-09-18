#!/usr/bin/env node
/**
 * 程序化生成 gitid 图标（无图像库依赖）：
 *   build/icon.png  512×512 应用图标（electron-builder 用）
 *   assets/tray.png  64×64 托盘图标
 * 图形语言：深色圆角底 + 双人形（白 + 绿），表达"多身份"。
 * 4× 超采样抗锯齿；PNG 手工编码（IHDR/IDAT/IEND + zlib + CRC32）。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---------- PNG 编码 ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 图形（坐标归一化到 0..1） ----------

const BG = [30, 41, 59];      // slate-800
const WHITE = [248, 250, 252];
const GREEN = [52, 211, 153]; // emerald-400

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
  const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function insidePerson(x, y, cx, cy, s) {
  // 头
  const hd = (x - cx) ** 2 + (y - (cy - 0.16 * s)) ** 2;
  if (hd <= (0.115 * s) ** 2) return true;
  // 肩（上半椭圆）
  const rx = 0.19 * s, ry = 0.145 * s, by = cy + 0.13 * s;
  const bd = ((x - cx) / rx) ** 2 + ((y - by) / ry) ** 2;
  return bd <= 1 && y <= by;
}

function sample(x, y) {
  // 背景圆角方
  if (!insideRoundedRect(x, y, 0.04, 0.04, 0.96, 0.96, 0.18)) return [0, 0, 0, 0];
  const px = (v) => Math.max(0, Math.min(1, v));
  // 白色主人在左，绿色小人在右下（半重叠 = 多身份切换）
  if (insidePerson(x, y, 0.415, 0.44, 1.0)) return [...WHITE, 255];
  if (insidePerson(x, y, 0.63, 0.545, 0.72)) return [...GREEN, 255];
  return [...BG, 255];
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // 超采样
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb, ca] = sample((pxi + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS;
      const o = (py * size + pxi) * 4;
      const alpha = Math.round(a / n);
      rgba[o] = alpha ? Math.round(r / a) : 0;
      rgba[o + 1] = alpha ? Math.round(g / a) : 0;
      rgba[o + 2] = alpha ? Math.round(b / a) : 0;
      rgba[o + 3] = alpha;
    }
  }
  return encodePNG(size, size, rgba);
}

mkdirSync(resolve(here, '../build'), { recursive: true });
mkdirSync(resolve(here, '../assets'), { recursive: true });
mkdirSync(resolve(here, '../renderer/src/assets'), { recursive: true });
writeFileSync(resolve(here, '../build/icon.png'), render(512));
writeFileSync(resolve(here, '../assets/tray.png'), render(64));
writeFileSync(resolve(here, '../renderer/src/assets/logo.png'), render(128));
console.log('icons written: build/icon.png (512), assets/tray.png (64), renderer/src/assets/logo.png (128)');
