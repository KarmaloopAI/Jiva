#!/usr/bin/env node
/**
 * Gritsa Past Posts Context Fetcher
 *
 * Fetches the front-matter headers of recent posts from the
 * gritsa/www-gritsa.github.io GitHub repository and prints a compact
 * summary to stdout.  The auto-blogger agent uses this to avoid
 * repeating topics that have already been covered.
 *
 * Usage:
 *   node get-past-posts.js [--limit N]   (default: 20 most-recent posts)
 *
 * Output (plain text, one post per line):
 *   YYYY-MM-DD | Title | Excerpt (first 120 chars)
 */
'use strict';

const https = require('https');

const GITHUB_PAT   = process.env.GITHUB_PAT || process.env.GRITSA_GITHUB_PAT || '';
const REPO_OWNER   = 'gritsa';
const REPO_NAME    = 'www-gritsa.github.io';
const POSTS_DIR    = '_posts';
const LIMIT        = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '', 10) || 20;
const CHECK_TODAY  = process.argv.includes('--check-today');

// Today's date in IST (UTC+5:30) — the scheduler runs in Asia/Kolkata timezone
function todayIST() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path:     apiPath,
      method:   'GET',
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'User-Agent':    'jiva-auto-blogger/2.0',
        'Accept':        'application/vnd.github.v3+json',
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API ${res.statusCode} for ${apiPath}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function extractFrontMatter(rawContent) {
  const m = rawContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w_]+):\s*"?(.+?)"?\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

async function main() {
  // 1. List all post files (sorted alphabetically = chronological for YYYY-MM-DD filenames)
  let files;
  try {
    files = await githubGet(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_DIR}`);
  } catch (err) {
    console.error(`Failed to list posts: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(files)) {
    console.error('Unexpected response format from GitHub API');
    process.exit(1);
  }

  // Most-recent first
  const recent = files
    .filter(f => f.name.endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, LIMIT);

  const summaries = [];

  for (const file of recent) {
    try {
      const meta = await githubGet(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_DIR}/${file.name}`);
      const raw  = Buffer.from(meta.content, 'base64').toString('utf8');
      const fm   = extractFrontMatter(raw);

      // Extract date from filename (YYYY-MM-DD-slug.md)
      const dateMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})/);
      const date  = dateMatch ? dateMatch[1] : (fm.date || '').split(' ')[0];
      const title = fm.title   || file.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ').replace(/\.md$/, '');
      const excerpt = (fm.excerpt || '').slice(0, 120);
      const tags    = fm.tags || '';

      summaries.push(`${date} | ${title}${tags ? ` [${tags}]` : ''}${excerpt ? ` — ${excerpt}` : ''}`);
    } catch {
      // Skip files that fail (private/large/rate-limited)
    }
  }

  if (summaries.length === 0) {
    if (CHECK_TODAY) console.log(`NO_POST_TODAY: ${todayIST()}`);
    else console.log('(no past posts found — this appears to be a fresh blog)');
    return;
  }

  // --check-today: emit a single status line first so the agent can short-circuit
  if (CHECK_TODAY) {
    const today = todayIST();
    const alreadyPosted = summaries.some(s => s.startsWith(today));
    console.log(alreadyPosted
      ? `ALREADY_POSTED_TODAY: ${today} — a post was already published today, skip to activity log`
      : `NO_POST_TODAY: ${today} — no post yet today, proceed with workflow`
    );
    console.log('');
  }

  console.log(`# Past Blog Posts (${summaries.length} most recent)\n`);
  console.log('Use this list to avoid repeating topics already covered.\n');
  summaries.forEach(s => console.log(`- ${s}`));
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
