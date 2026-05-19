#!/usr/bin/env node
/**
 * Gritsa Blog Image Generator
 *
 * Uses Gemini 2.5 Flash Image to generate a featured header image for a blog post.
 *
 * Usage:
 *   node generate-image.js "<image prompt>" [output-path]
 *
 * Output path defaults to /tmp/gritsa-blog-image.png
 *
 * Style constraints (no text, 16:9, teal/blue palette) are appended automatically.
 */

// Must be async top-level to use dynamic import() for the ESM-only @google/genai package
(async () => {
  'use strict';

  const path = require('path');
  const fs   = require('fs');

  const SCRIPT_DIR  = __dirname;
  const NM_LOCAL    = path.join(SCRIPT_DIR, 'node_modules');
  const NM_FALLBACK = '/tmp/genai-deps/node_modules';

  // Install @google/genai if not present in either location
  function ensureInstalled() {
    const pkg = path.join(NM_LOCAL, '@google', 'genai', 'package.json');
    const pkg2 = path.join(NM_FALLBACK, '@google', 'genai', 'package.json');
    if (fs.existsSync(pkg) || fs.existsSync(pkg2)) return;

    console.log('[generate-image] Installing @google/genai...');
    const { execSync } = require('child_process');
    const installDir = path.dirname(NM_FALLBACK);
    fs.mkdirSync(installDir, { recursive: true });
    execSync(
      `npm install --prefix ${installDir} @google/genai mime --no-save --silent`,
      { env: { ...process.env, HOME: '/tmp', NPM_CONFIG_CACHE: '/tmp/.npm' } }
    );
  }

  function resolveESM(pkg) {
    // Try local (baked-in) first, then fallback install dir
    for (const base of [NM_LOCAL, NM_FALLBACK]) {
      const pkgJson = path.join(base, ...pkg.split('/'), 'package.json');
      if (fs.existsSync(pkgJson)) {
        const meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        // Prefer the ESM export
        const esmMain = meta.exports?.['.']?.import?.default
          || meta.exports?.['.']?.import
          || meta.module
          || meta.main;
        const resolved = path.join(base, ...pkg.split('/'), esmMain || 'dist/index.mjs');
        return 'file://' + resolved;
      }
    }
    return pkg; // Let Node resolve normally as last resort
  }

  ensureInstalled();

  // Dynamic import for ESM package
  const genaiUrl = resolveESM('@google/genai');
  const { GoogleGenAI } = await import(genaiUrl);

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  const MODEL          = 'gemini-2.5-flash-image';

  // Style appended to every prompt — enforces blog header look & feel
  const STYLE_SUFFIX = [
    'Wide horizontal blog header image.',
    '16:9 aspect ratio, suitable for 1200×630 pixel display.',
    'Abstract, professional, corporate tech aesthetic.',
    'Dominant teal and navy blue color palette with subtle gradient highlights.',
    'No text, no words, no letters, no numbers anywhere in the image.',
    'Clean, minimalist, modern design. High quality.',
  ].join(' ');

  const userPrompt = process.argv[2];
  const outputPath = process.argv[3] || '/tmp/gritsa-blog-image.png';

  if (!userPrompt) {
    console.error('Usage: node generate-image.js "<prompt>" [output-path]');
    process.exit(1);
  }

  const fullPrompt = `${userPrompt.trim()}. ${STYLE_SUFFIX}`;
  console.log(`[generate-image] Model  : ${MODEL}`);
  console.log(`[generate-image] Prompt : ${fullPrompt.substring(0, 100)}...`);
  console.log(`[generate-image] Output : ${outputPath}`);

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const response = await ai.models.generateContentStream({
    model: MODEL,
    config: { responseModalities: ['IMAGE', 'TEXT'] },
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
  });

  let saved = false;

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;

    for (const part of parts) {
      if (part.inlineData?.data) {
        // Determine extension from mime type
        const mimeType = part.inlineData.mimeType || 'image/png';
        const ext      = mimeType.split('/')[1]?.split(';')[0] || 'png';
        const dest     = outputPath.replace(/\.[^.]+$/, `.${ext}`);

        const buffer = Buffer.from(part.inlineData.data, 'base64');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buffer);

        console.log(`✅ Image saved: ${dest} (${(buffer.length / 1024).toFixed(0)} KB, ${mimeType})`);
        console.log(`IMAGE_PATH=${dest}`);
        saved = true;
        break;
      }
    }
    if (saved) break;
  }

  if (!saved) {
    console.error('❌ No image data received from Gemini');
    process.exit(1);
  }
})();
