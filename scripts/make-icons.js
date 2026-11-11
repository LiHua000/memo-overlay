'use strict';

/* 纯 Node 生成应用图标与托盘图标，不依赖任何图形库。 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets');
const SS = 4; // 超采样倍数，边缘更平滑

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** 圆角矩形有符号距离场，<= 0 表示在内部 */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function renderIcon(size) {
  const N = size * SS;
  const buf = new Float32Array(N * N * 4); // 预乘 alpha
  const margin = N * 0.035;
  const hw = N / 2 - margin;
  const hh = hw;
  const radius = N * 0.245;
  const cx = N / 2;
  const cy = N / 2;
  const borderWidth = Math.max(1, N * 0.006);

  const bars = [
    // [x, y, w, h, r, g, b, a]
    [0.225, 0.300, 0.300, 0.085, 245, 196, 107, 1.0],
    [0.225, 0.470, 0.520, 0.062, 152, 161, 183, 0.95],
    [0.225, 0.600, 0.375, 0.062, 96, 104, 127, 0.95],
  ];

  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const sd = sdRoundRect(px, py, cx, cy, hw, hh, radius);
      if (sd > 0) continue;

      const t = y / (N - 1);
      let r = lerp(39, 17, t);
      let g = lerp(44, 19, t);
      let b = lerp(56, 25, t);

      const gx = (x - N * 0.18) / (N * 0.72);
      const gy = (y - N * 0.10) / (N * 0.78);
      const glow = Math.pow(clamp01(1 - Math.hypot(gx, gy)), 2) * 12;
      r += glow;
      g += glow * 0.95;
      b += glow * 0.8;

      if (sd > -borderWidth) {
        const k = 0.22;
        r = lerp(r, 255, k);
        g = lerp(g, 255, k);
        b = lerp(b, 255, k);
      }

      let sr = r;
      let sg = g;
      let sb = b;
      let sa = 1;

      for (const [bx, by, bw, bh, br, bg, bb, ba] of bars) {
        const bxC = bx * N + (bw * N) / 2;
        const byC = by * N + (bh * N) / 2;
        const bhw = (bw * N) / 2;
        const bhh = (bh * N) / 2;
        const barSd = sdRoundRect(px, py, bxC, byC, bhw, bhh, bhh);
        if (barSd <= 0.5) {
          const k = ba * clamp01(0.5 - barSd);
          sr = lerp(sr, br, k);
          sg = lerp(sg, bg, k);
          sb = lerp(sb, bb, k);
        }
      }

      const i = (y * N + x) * 4;
      buf[i] = sr;
      buf[i + 1] = sg;
      buf[i + 2] = sb;
      buf[i + 3] = sa;
    }
  }

  // 下采样（预乘 alpha 平均）
  const out = new Uint8Array(size * size * 4);
  const f = SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < f; sy += 1) {
        for (let sx = 0; sx < f; sx += 1) {
          const i = ((y * f + sy) * N + (x * f + sx)) * 4;
          const alpha = buf[i + 3];
          r += buf[i] * alpha;
          g += buf[i + 1] * alpha;
          b += buf[i + 2] * alpha;
          a += alpha;
        }
      }
      const count = f * f;
      const alpha = a / count;
      const oi = (y * size + x) * 4;
      out[oi + 3] = Math.round(clamp01(alpha) * 255);
      if (a > 0) {
        // r/g/b 已按 alpha 加权，除以 alpha 得到 0..255 的颜色
        out[oi] = Math.round(Math.min(255, Math.max(0, r / a)));
        out[oi + 1] = Math.round(Math.min(255, Math.max(0, g / a)));
        out[oi + 2] = Math.round(Math.min(255, Math.max(0, b / a)));
      }
    }
  }
  return out;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = [
    ['icon.png', 256],
    ['tray.png', 32],
  ];
  for (const [name, size] of targets) {
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, encodePng(size, renderIcon(size)));
    console.log(`[icons] ${name} (${size}x${size})`);
  }
}

main();
