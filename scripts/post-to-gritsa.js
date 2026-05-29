#!/usr/bin/env node
/**
 * Gritsa Blog Publisher
 *
 * Publishes a markdown blog post (with optional featured image) to the
 * gritsa/www-gritsa.github.io GitHub repository.
 *
 * Usage:
 *   node post-to-gritsa.js <post-markdown-path> [image-path]
 *
 * If image-path is omitted, checks /tmp/gritsa-blog-image.png automatically.
 * If an image is found, it is uploaded to assets/img/posts/ in the repo and
 * the featured_image front-matter field is injected into the post.
 */
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const GITHUB_PAT   = process.env.GITHUB_PAT || process.env.GRITSA_GITHUB_PAT || '';
const REPO_OWNER   = 'gritsa';
const REPO_NAME    = 'www-gritsa.github.io';
const BRANCH       = 'main';
const POSTS_DIR    = '_posts';
const IMAGES_DIR   = 'assets/img/posts';
const AUTHOR       = 'Gritsa';
const DEFAULT_IMG  = '/tmp/gritsa-blog-image.png';

// ── Helpers ──────────────────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Use IST (UTC+5:30) consistently for post and image filenames so the
// "already posted today" check in get-past-posts.js (which also uses IST)
// matches the filename prefix.  Previously todayISO() used UTC, causing a
// mismatch: posts published between 18:30–23:59 UTC got a UTC filename that
// was one day behind the IST "today" the deduplication check compared against,
// letting the agent publish multiple posts for the same IST calendar day.
function todayIST() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().split('T')[0]; // YYYY-MM-DD in IST
}

function todayJekyll() {
  // Record actual UTC time with +0000 in front-matter (informational only).
  // Jekyll uses the *filename* date for URLs, so this doesn't affect deduplication.
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} +0000`;
}

function parseFrontMatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return { frontMatter: {}, body: content };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return { frontMatter: fm, body: m[2] };
}

function extractTitle(body) {
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : 'New Post';
}

function extractExcerpt(body) {
  const p = body.replace(/^#+.+$/gm, '').trim().split(/\n\n/)[0]
                .replace(/[#*`]/g, '').trim();
  return p.length > 200 ? p.substring(0, 197) + '...' : p;
}

function buildFrontMatter(fm) {
  const title       = fm.title       || 'New Post';
  const date        = fm.date        || todayJekyll();
  const author      = fm.author      || AUTHOR;
  const excerpt     = fm.excerpt     || '';
  const image       = fm.featured_image || '';
  // SEO fields — agent should populate these; fall back to excerpt/title if absent
  const description = fm.description || fm.excerpt || '';
  const keywords    = fm.keywords    || '';
  const tags        = fm.tags        || '';
  const categories  = fm.categories  || 'AI Technology';

  let b = `---\nlayout: post\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${date}\nauthor: "${author}"\n`;
  b += `categories: "${categories}"\n`;
  if (tags)        b += `tags: "${tags}"\n`;
  if (excerpt)     b += `excerpt: "${excerpt.replace(/"/g, '\\"')}"\n`;
  if (description) b += `description: "${description.replace(/"/g, '\\"')}"\n`;
  if (keywords)    b += `keywords: "${keywords}"\n`;
  if (image)       b += `featured_image: "${image}"\n`;
  return b + '---\n';
}

function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path:     apiPath,
      method,
      headers: {
        'Authorization':  `token ${GITHUB_PAT}`,
        'User-Agent':     'jiva-auto-blogger/2.0',
        'Accept':         'application/vnd.github.v3+json',
        'Content-Type':   'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
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

async function getExistingSha(apiPath) {
  try {
    const e = await githubRequest('GET', apiPath);
    return e.sha;
  } catch {
    return null;
  }
}

// ── Image upload ──────────────────────────────────────────────────────────────
async function uploadImage(imagePath, slug) {
  if (!imagePath || !fs.existsSync(imagePath)) return null;

  const ext      = path.extname(imagePath).toLowerCase() || '.png';
  const imgName  = `${todayIST()}-${slug}${ext}`;
  const apiPath  = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMAGES_DIR}/${imgName}`;
  const imgBytes = fs.readFileSync(imagePath);
  const b64      = imgBytes.toString('base64');

  console.log(`🖼️  Uploading image: ${imgName} (${(imgBytes.length / 1024).toFixed(0)} KB)`);

  const existingSha = await getExistingSha(apiPath);

  await githubRequest('PUT', apiPath, {
    message:  `blog: add image for "${slug}"`,
    content:  b64,
    branch:   BRANCH,
    ...(existingSha ? { sha: existingSha } : {}),
  });

  const publicPath = `/${IMAGES_DIR}/${imgName}`;
  console.log(`   ✅ Image path: ${publicPath}`);
  return publicPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const filePath  = process.argv[2];
  const imgArg    = process.argv[3] || DEFAULT_IMG;

  if (!filePath) {
    console.error('Usage: node post-to-gritsa.js <post.md> [image.png]');
    process.exit(1);
  }

  // ── Parse post ───────────────────────────────────────────────────────────
  const rawContent = fs.readFileSync(path.resolve(filePath), 'utf8');
  let { frontMatter: fm, body } = parseFrontMatter(rawContent);

  if (!fm.title)   fm.title   = extractTitle(body);
  if (!fm.excerpt) fm.excerpt = extractExcerpt(body);
  // Always stamp with actual publish time so Jekyll never treats it as a future post
  fm.date = todayJekyll();

  const datePrefix = todayIST();
  const slug       = slugify(fm.title);
  const filename   = `${datePrefix}-${slug}.md`;
  const postPath   = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_DIR}/${filename}`;

  console.log(`📝 Preparing post: ${filename}`);
  console.log(`   Title  : ${fm.title}`);

  // ── Upload image first (so we can inject path into front matter) ──────────
  const imageFsPath = fs.existsSync(imgArg) ? imgArg : null;
  if (imageFsPath) {
    const imgPublicPath = await uploadImage(imageFsPath, slug);
    if (imgPublicPath) fm.featured_image = imgPublicPath;
  } else {
    console.log('   (no featured image found — skipping image upload)');
  }

  // ── Build final post content ───────────────────────────────────────────────
  const finalContent = buildFrontMatter(fm) + '\n' + body.trimStart();

  // ── Publish post ──────────────────────────────────────────────────────────
  const existingSha = await getExistingSha(postPath);
  if (existingSha) {
    console.log(`   Updating existing post (sha: ${existingSha.substring(0, 8)})`);
  } else {
    console.log('   Creating new post');
  }

  const result = await githubRequest('PUT', postPath, {
    message: `blog: add "${fm.title}"`,
    content: Buffer.from(finalContent, 'utf8').toString('base64'),
    branch:  BRANCH,
    ...(existingSha ? { sha: existingSha } : {}),
  });

  const postUrl = `https://www.gritsa.com/blog/${datePrefix.replace(/-/g, '/')}/${slug}/`;
  console.log(`\n✅ Published successfully!`);
  console.log(`   GitHub : ${result.content.html_url}`);
  console.log(`   Blog   : ${postUrl}`);
}

main().catch(err => {
  console.error('❌ Publishing failed:', err.message);
  process.exit(1);
});
