#!/usr/bin/env node
/**
 * Fallback Blog Image Generator
 *
 * Creates a 1200×630 PNG with a bilinear gradient background and title text overlay.
 * Uses jimp (pure JS, no native binaries) — installed alongside @google/genai in
 * the scripts/node_modules directory.
 *
 * Falls back to a plain gradient if jimp font loading fails.
 *
 * Usage:
 *   node generate-fallback-image.js "Title Words" [/output/path.png] [gradientIndex]
 */
'use strict';

const path = require('path');
const fs   = require('fs');

// ── 5 Rich gradient themes (bilinear — 4 corners as [r,g,b]) ─────────────
// Each gives a distinct colour story different from the standard teal
const GRADIENTS = [
  {
    name: 'aurora',
    tl: [8,  0,  35],  tr: [0,  70, 110],
    bl: [30, 0,  70],  br: [0,  130, 110],
  },
  {
    name: 'sunset',
    tl: [60, 5,  30],  tr: [190, 50, 10],
    bl: [90, 0,  50],  br: [220, 110, 0],
  },
  {
    name: 'ocean',
    tl: [0,  15, 70],  tr: [0,  90, 140],
    bl: [0,  40, 100], br: [10, 160, 160],
  },
  {
    name: 'indigo',
    tl: [15, 0,  70],  tr: [70, 0,  150],
    bl: [35, 0,  110], br: [110, 30, 190],
  },
  {
    name: 'forest',
    tl: [0,  25, 15],  tr: [0,  85, 55],
    bl: [15, 50, 0],   br: [30, 140, 40],
  },
];

// ── Pick gradient deterministically from title ────────────────────────────
function pickGradient(title) {
  let h = 5381;
  for (const c of (title || '')) h = (((h << 5) + h) + c.charCodeAt(0)) & 0xFFFFFFFF;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

// ── Bilinear interpolation helper ─────────────────────────────────────────
function bilerp(tl, tr, bl, br, tx, ty) {
  const top = tl + (tr - tl) * tx;
  const bot = bl + (br - bl) * tx;
  return Math.round(top + (bot - top) * ty);
}

// ── Resolve jimp from scripts/node_modules (baked into Docker image) ──────
function requireJimp() {
  // Try local scripts/node_modules first (installed in Dockerfile)
  const localPath = path.join(__dirname, 'node_modules', 'jimp');
  if (fs.existsSync(path.join(localPath, 'package.json'))) {
    return require(localPath);
  }
  // Try fallback install location
  const fallbackPath = '/tmp/jimp-deps/node_modules/jimp';
  if (fs.existsSync(path.join(fallbackPath, 'package.json'))) {
    return require(fallbackPath);
  }
  // Last resort: install jimp on the fly
  console.log('[fallback-image] Installing jimp...');
  const { execSync } = require('child_process');
  execSync('npm install --prefix /tmp/jimp-deps jimp@0.16 --no-save --silent', {
    env:   { ...process.env, HOME: '/tmp', NPM_CONFIG_CACHE: '/tmp/.npm' },
    stdio: 'pipe',
  });
  return require('/tmp/jimp-deps/node_modules/jimp');
}

async function run() {
  const title      = process.argv[2] || 'Gritsa Blog';
  const outputPath = process.argv[3] || '/tmp/gritsa-blog-image.png';

  const grad = pickGradient(title);
  console.log(`[fallback-image] Gradient: ${grad.name}  |  Title: "${title}"`);
  console.log(`[fallback-image] Output  : ${outputPath}`);

  let Jimp;
  try {
    Jimp = requireJimp();
  } catch (e) {
    console.error('[fallback-image] Could not load jimp:', e.message);
    // Ultra-fallback: write a minimal solid-colour PNG using raw bytes
    await writePlainGradientPNG(outputPath, grad);
    return;
  }

  const W = 1200, H = 630;

  // ── Draw bilinear gradient ──────────────────────────────────────────────
  const image = new Jimp(W, H, 0x000000FF);
  image.scan(0, 0, W, H, function (x, y, idx) {
    const tx = x / (W - 1), ty = y / (H - 1);
    this.bitmap.data[idx]     = bilerp(grad.tl[0], grad.tr[0], grad.bl[0], grad.br[0], tx, ty);
    this.bitmap.data[idx + 1] = bilerp(grad.tl[1], grad.tr[1], grad.bl[1], grad.br[1], tx, ty);
    this.bitmap.data[idx + 2] = bilerp(grad.tl[2], grad.tr[2], grad.bl[2], grad.br[2], tx, ty);
    this.bitmap.data[idx + 3] = 255;
  });

  // ── Darken a horizontal band in the centre for text contrast ─────────────
  const bandTop = Math.floor(H * 0.33);
  const bandBot = Math.floor(H * 0.67);
  image.scan(0, bandTop, W, bandBot - bandTop, function (x, y, idx) {
    this.bitmap.data[idx]     = Math.round(this.bitmap.data[idx]     * 0.3);
    this.bitmap.data[idx + 1] = Math.round(this.bitmap.data[idx + 1] * 0.3);
    this.bitmap.data[idx + 2] = Math.round(this.bitmap.data[idx + 2] * 0.3);
  });

  // ── Render title text ─────────────────────────────────────────────────────
  // Take first 4 words, uppercase, strip special chars
  const words = title
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
    .toUpperCase();

  try {
    const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    // Print with centre alignment across the full width
    image.print(
      font,
      60,   // x padding
      0,    // y start — alignment will centre it vertically
      {
        text:         words,
        alignmentX:   Jimp.HORIZONTAL_ALIGN_CENTER,
        alignmentY:   Jimp.VERTICAL_ALIGN_MIDDLE,
      },
      W - 120,  // max width
      H         // max height — VERTICAL_ALIGN_MIDDLE centres within this
    );
    console.log(`[fallback-image] Text rendered: "${words}"`);
  } catch (fontErr) {
    // Font loading can fail if jimp package is incomplete — degrade gracefully
    console.warn('[fallback-image] Font unavailable, saving gradient-only:', fontErr.message);
  }

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  await image.writeAsync(outputPath);
  console.log(`✅ Fallback image saved: ${outputPath} (${grad.name} gradient)`);
  console.log(`IMAGE_PATH=${outputPath}`);
}

// ── Ultra-fallback: write a plain gradient PNG using only zlib ─────────────
// Called when jimp is completely unavailable.
async function writePlainGradientPNG(outputPath, grad) {
  const zlib = require('zlib');
  const W = 1200, H = 630, channels = 3;

  // Build raw scanline data (filter byte 0 + RGB pixels per row)
  const rowSize = 1 + W * channels;
  const raw     = Buffer.alloc(H * rowSize, 0);

  for (let y = 0; y < H; y++) {
    const base = y * rowSize;
    raw[base] = 0; // filter type None
    const ty = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const tx  = x / (W - 1);
      const off = base + 1 + x * channels;
      raw[off]     = bilerp(grad.tl[0], grad.tr[0], grad.bl[0], grad.br[0], tx, ty);
      raw[off + 1] = bilerp(grad.tl[1], grad.tr[1], grad.bl[1], grad.br[1], tx, ty);
      raw[off + 2] = bilerp(grad.tl[2], grad.tr[2], grad.bl[2], grad.br[2], tx, ty);
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  // CRC32 helper
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; }
  function mkChunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const crcBuf = u32(crc32(Buffer.concat([t, data])));
    return Buffer.concat([u32(data.length), t, data, crcBuf]);
  }

  const ihdrData = Buffer.concat([u32(W), u32(H),
    Buffer.from([8, 2, 0, 0, 0])]);  // 8-bit RGB, no filter, no interlace

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    mkChunk('IHDR', ihdrData),
    mkChunk('IDAT', compressed),
    mkChunk('IEND', Buffer.alloc(0)),
  ]);

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, png);
  console.log(`✅ Plain gradient PNG saved: ${outputPath} (${grad.name})`);
  console.log(`IMAGE_PATH=${outputPath}`);
}

run().catch(err => {
  console.error('❌ Fallback image generation failed:', err.message);
  process.exit(1);
});
