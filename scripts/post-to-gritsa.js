#!/usr/bin/env node
/**
 * post-to-gritsa.js
 * Posts a markdown blog post to the Gritsa Jekyll website repo.
 *
 * Usage: node post-to-gritsa.js <path-to-markdown-file>
 *
 * The markdown file may optionally include Jekyll front matter.
 * If front matter is absent the script will generate it from the
 * first H1 heading found in the content.
 */

'use strict';

const https = require('https');
const fs   = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const GITHUB_PAT  = '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';
const REPO_OWNER  = 'gritsa';
const REPO_NAME   = 'www-gritsa.github.io';
const BRANCH      = 'main';
const POSTS_DIR   = '_posts';
const AUTHOR      = 'Gritsa';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function todayISO() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function todayJekyll() {
  const now = new Date();
  const pad  = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} +0000`;
}

/**
 * Parse existing Jekyll front matter from markdown content.
 * Returns { frontMatter, body } where frontMatter is an object (may be empty)
 * and body is the markdown content without the front matter block.
 */
function parseFrontMatter(content) {
  const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(FM_RE);
  if (!match) return { frontMatter: {}, body: content };

  const rawYaml = match[1];
  const body    = match[2];
  const fm      = {};

  for (const line of rawYaml.split('\n')) {
    const kv = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }

  return { frontMatter: fm, body };
}

/**
 * Extract first H1 heading from markdown body.
 */
function extractTitle(body) {
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : 'New Post';
}

/**
 * Extract first paragraph as excerpt (max 200 chars).
 */
function extractExcerpt(body) {
  const cleaned = body.replace(/^#+.+$/gm, '').replace(/^---[\s\S]*?---/, '').trim();
  const para = cleaned.split(/\n\n/)[0].replace(/[#*`]/g, '').trim();
  return para.length > 200 ? para.substring(0, 197) + '...' : para;
}

/**
 * Build the Jekyll front matter block.
 */
function buildFrontMatter(fm) {
  const title   = fm.title   || 'New Post';
  const date    = fm.date    || todayJekyll();
  const author  = fm.author  || AUTHOR;
  const excerpt = fm.excerpt || '';
  const image   = fm.featured_image || '';

  let block = `---\nlayout: post\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${date}\nauthor: "${author}"\n`;
  if (excerpt) block += `excerpt: "${excerpt.replace(/"/g, '\\"')}"\n`;
  if (image)   block += `featured_image: "${image}"\n`;
  block += `---\n`;
  return block;
}

/**
 * Make an authenticated HTTPS request to the GitHub API.
 */
function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'User-Agent':    'jiva-auto-blogger/1.0',
        'Accept':        'application/vnd.github.v3+json',
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node post-to-gritsa.js <path-to-markdown-file>');
    process.exit(1);
  }

  const rawContent = fs.readFileSync(path.resolve(filePath), 'utf8');
  let { frontMatter: fm, body } = parseFrontMatter(rawContent);

  // Fill in any missing front matter fields
  if (!fm.title)   fm.title   = extractTitle(body);
  if (!fm.excerpt) fm.excerpt = extractExcerpt(body);

  // Build the full Jekyll post content
  const finalContent = buildFrontMatter(fm) + '\n' + body.trimStart();

  // Derive Jekyll filename
  const datePrefix = todayISO();
  const slug       = slugify(fm.title);
  const filename   = `${datePrefix}-${slug}.md`;
  const apiPath    = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_DIR}/${filename}`;

  console.log(`📝 Posting: ${filename}`);
  console.log(`   Title  : ${fm.title}`);
  console.log(`   Excerpt: ${fm.excerpt.substring(0, 80)}...`);

  // Check if the file already exists (to get its SHA for updates)
  let existingSha;
  try {
    const existing = await githubRequest('GET', apiPath);
    existingSha = existing.sha;
    console.log(`   File exists — will update (sha: ${existingSha.substring(0, 8)})`);
  } catch {
    console.log('   File does not exist — creating new post');
  }

  const payload = {
    message: `blog: add "${fm.title}"`,
    content: Buffer.from(finalContent, 'utf8').toString('base64'),
    branch:  BRANCH,
    ...(existingSha ? { sha: existingSha } : {}),
  };

  const result = await githubRequest('PUT', apiPath, payload);
  const postUrl = `https://gritsa.github.io/${datePrefix.replace(/-/g, '/')}/${slug}.html`;

  console.log(`\n✅ Published successfully!`);
  console.log(`   GitHub : ${result.content.html_url}`);
  console.log(`   Blog   : ${postUrl}`);
}

main().catch(err => {
  console.error('❌ Failed to post:', err.message);
  process.exit(1);
});
