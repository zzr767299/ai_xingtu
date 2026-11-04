#!/usr/bin/env node
/**
 * 生成应用图标 public/favicon.ico（深空底 + 金色星星），供浏览器标签页与桌面快捷方式使用。
 * 纯 Node 实现：超采样绘制 → PNG 编码 → 打包多尺寸 ICO，无需第三方依赖。
 * 用法：node scripts/make-icon.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 32, 48, 256];
const SS = 4; // 每个像素 4x4 超采样

const starPoints = (cx, cy, outer, inner) => {
  const points = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
};

const inPolygon = (x, y, points) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const inRoundedRect = (x, y, size, radius) => {
  const min = radius;
  const max = size - radius;
  if (x >= min && x <= max) return y >= 0 && y <= size;
  if (y >= min && y <= max) return x >= 0 && x <= size;
  const cx = x < min ? min : max;
  const cy = y < min ? min : max;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

const mix = (a, b, t) => a + (b - a) * t;

function render(size) {
  const big = size * SS;
  const star = starPoints(big * 0.5, big * 0.52, big * 0.36, big * 0.148);
  const pixels = new Float64Array(big * big * 4);

  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const index = (y * big + x) * 4;
      const radius = big * 0.22;
      if (!inRoundedRect(x + 0.5, y + 0.5, big, radius)) continue;

      // 深空底：纵向渐变 + 左上角冷光
      const t = y / big;
      let r = mix(18, 8, t);
      let g = mix(26, 12, t);
      let b = mix(46, 20, t);
      const glow = Math.max(0, 1 - Math.hypot(x - big * 0.28, y - big * 0.2) / (big * 0.62));
      r += glow * 10;
      g += glow * 26;
      b += glow * 38;

      if (inPolygon(x + 0.5, y + 0.5, star)) {
        // 金色星星：自上而下由亮金过渡到橙色
        const s = (y / big - 0.16) / 0.72;
        r = mix(255, 246, s);
        g = mix(226, 178, s);
        b = mix(132, 58, s);
      } else {
        // 星星外的柔和外发光
        const distance = Math.hypot(x - big * 0.5, y - big * 0.52);
        const halo = Math.max(0, 1 - Math.abs(distance - big * 0.36) / (big * 0.05));
        r += halo * 12;
        g += halo * 22;
        b += halo * 6;
      }

      pixels[index] = Math.min(255, r);
      pixels[index + 1] = Math.min(255, g);
      pixels[index + 2] = Math.min(255, b);
      pixels[index + 3] = 255;
    }
  }

  // 降采样
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const index = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          r += pixels[index];
          g += pixels[index + 1];
          b += pixels[index + 2];
          a += pixels[index + 3];
        }
      }
      const count = SS * SS;
      const target = (y * size + x) * 4;
      out[target] = Math.round(r / count);
      out[target + 1] = Math.round(g / count);
      out[target + 2] = Math.round(b / count);
      out[target + 3] = Math.round(a / count);
    }
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
};

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const images = SIZES.map((size) => ({ size, png: encodePng(size, render(size)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const entries = images.map(({ size, png }) => {
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});

const ico = Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
mkdirSync(path.join(projectRoot, "public"), { recursive: true });
writeFileSync(path.join(projectRoot, "public", "favicon.ico"), ico);
if (process.argv.includes("--preview")) {
  writeFileSync(path.join(projectRoot, "public", "favicon-preview.png"), encodePng(256, render(256)));
  console.log("已输出预览图 public/favicon-preview.png");
}
console.log(`已生成 public/favicon.ico（${SIZES.join("/")}）`);
