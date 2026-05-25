#!/usr/bin/env node
/**
 * Gritsa Blog Image Generator
 *
 * Uses Gemini Flash Image to generate a featured header image for a blog post.
 * Automatically picks a varied visual style based on the prompt so consecutive posts
 * don't all look the same.
 *
 * On Gemini failure, falls back to generate-fallback-image.js (gradient + text).
 *
 * Usage:
 *   node generate-image.js "<image prompt>" [output-path] ["Post Title"]
 *
 * Output path defaults to /tmp/gritsa-blog-image.png
 * Post Title (3rd arg) is used in the fallback gradient image and enriches the Gemini prompt.
 */

(async () => {
  'use strict';

  const path = require('path');
  const fs   = require('fs');
  const { execSync } = require('child_process');

  const SCRIPT_DIR  = __dirname;
  const NM_LOCAL    = path.join(SCRIPT_DIR, 'node_modules');
  const NM_FALLBACK = '/tmp/genai-deps/node_modules';

  // ── Build a dynamic, title-aware Gemini prompt ────────────────────────────
  // The concept from the directive drives *what* is depicted; the post title
  // gives the model richer thematic context for colour and composition.
  function buildFullPrompt(concept, postTitle) {
    const titleHint = postTitle
      ? `The blog post is titled: "${postTitle}". `
      : '';
    return [
      titleHint + concept.trim(),
      'Create a wide horizontal blog header image (16:9, 1200×630).',
      'Abstract and conceptual — visually evocative of the theme.',
      'Professional contemporary technology aesthetic with a strong colour mood.',
      'No text, no words, no letters, no numbers anywhere in the image.',
      'Cinematic lighting, high detail, suitable for a corporate technology blog.',
    ].join(' ');
  }

  // ── Ensure @google/genai is installed ──────────────────────────────────────
  function ensureInstalled() {
    const pkg  = path.join(NM_LOCAL,    '@google', 'genai', 'package.json');
    const pkg2 = path.join(NM_FALLBACK, '@google', 'genai', 'package.json');
    if (fs.existsSync(pkg) || fs.existsSync(pkg2)) return;
    console.log('[generate-image] Installing @google/genai...');
    const installDir = path.dirname(NM_FALLBACK);
    fs.mkdirSync(installDir, { recursive: true });
    execSync(
      `npm install --prefix ${installDir} @google/genai mime --no-save --silent`,
      { env: { ...process.env, HOME: '/tmp', NPM_CONFIG_CACHE: '/tmp/.npm' } }
    );
  }

  function resolveESM(pkg) {
    for (const base of [NM_LOCAL, NM_FALLBACK]) {
      const pkgJson = path.join(base, ...pkg.split('/'), 'package.json');
      if (fs.existsSync(pkgJson)) {
        const meta    = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        const esmMain = meta.exports?.['.']?.import?.default
          || meta.exports?.['.']?.import
          || meta.module
          || meta.main;
        return 'file://' + path.join(base, ...pkg.split('/'), esmMain || 'dist/index.mjs');
      }
    }
    return pkg;
  }

  // ── Fallback: call generate-fallback-image.js ──────────────────────────────
  function callFallback(userPrompt, outputPath, postTitle) {
    const fallbackScript = path.join(SCRIPT_DIR, 'generate-fallback-image.js');
    // Use the real post title when available; otherwise derive from concept prompt
    const titleArg = (postTitle || userPrompt.split(/\s+/).slice(0, 4).join(' ')).replace(/"/g, '\\"');
    try {
      execSync(`node "${fallbackScript}" "${titleArg}" "${outputPath}"`, {
        env:   { ...process.env, HOME: '/tmp', NPM_CONFIG_CACHE: '/tmp/.npm' },
        stdio: 'inherit',
      });
      return true;
    } catch (e) {
      console.error('[generate-image] Fallback also failed:', e.message);
      return false;
    }
  }

  // ── Entry point ───────────────────────────────────────────────────────────
  const userPrompt = process.argv[2];
  const outputPath = process.argv[3] || '/tmp/gritsa-blog-image.png';
  const postTitle  = process.argv[4] || '';

  if (!userPrompt) {
    console.error('Usage: node generate-image.js "<prompt>" [output-path] ["Post Title"]');
    process.exit(1);
  }

  const fullPrompt = buildFullPrompt(userPrompt, postTitle);

  if (postTitle) console.log(`[generate-image] Title  : ${postTitle}`);
  console.log(`[generate-image] Prompt : ${fullPrompt.substring(0, 140)}...`);
  console.log(`[generate-image] Output : ${outputPath}`);

  ensureInstalled();

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
  const MODEL = 'gemini-2.5-flash-image';

  let GoogleGenAI;
  try {
    const genaiUrl = resolveESM('@google/genai');
    ({ GoogleGenAI } = await import(genaiUrl));
  } catch (importErr) {
    console.error('[generate-image] Failed to import @google/genai:', importErr.message);
    console.warn('[generate-image] Falling back to gradient image...');
    process.exit(callFallback(userPrompt, outputPath, postTitle) ? 0 : 1);
    return;
  }

  const ai   = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  let saved  = false;

  try {
    const response = await ai.models.generateContentStream({
      model:    MODEL,
      config:   { responseModalities: ['IMAGE', 'TEXT'] },
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    });

    for await (const chunk of response) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          const ext      = mimeType.split('/')[1]?.split(';')[0] || 'png';
          const dest     = outputPath.replace(/\.[^.]+$/, `.${ext}`);
          const buffer   = Buffer.from(part.inlineData.data, 'base64');
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
  } catch (apiErr) {
    console.error('[generate-image] Gemini API error:', apiErr.message);
  }

  if (!saved) {
    console.warn('[generate-image] ❌ Gemini returned no image — generating fallback gradient...');
    process.exit(callFallback(userPrompt, outputPath, postTitle) ? 0 : 1);
  }
})();
