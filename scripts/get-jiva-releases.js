#!/usr/bin/env node
/**
 * Jiva Release Checker
 *
 * Fetches recent Jiva releases from GitHub and prints a summary to stdout.
 * The auto-blogger uses this to determine whether a new release warrants
 * a blog post (Priority 1 topic).
 *
 * Usage:
 *   node get-jiva-releases.js [--days N] [--past-posts-file PATH]
 *
 *   --days N              Look back N days for new releases (default: 7)
 *   --past-posts-file PATH  Path to output of get-past-posts.js.
 *                           If any recent release version already appears in
 *                           this file, it is marked ALREADY_COVERED and
 *                           excluded from the NEW RELEASE output entirely.
 *                           This prevents the LLM from re-posting about the
 *                           same release on consecutive days.
 *
 * Output:
 *   NEW RELEASE: v0.3.47 — released 2026-05-19 — "Multimodal & Vertex AI Fixes"
 *   ALREADY_COVERED: v0.3.47 — blogged about previously (skip to Priority 2)
 *   (or "No new Jiva releases in the past N days." if nothing recent)
 *
 * Exit codes:
 *   0  — success (even if no new releases found)
 *   1  — network/API error
 */
'use strict';

const https = require('https');
const fs    = require('fs');

const DAYS           = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '', 10) || 7;
const PAST_POSTS_ARG = process.argv.find(a => a.startsWith('--past-posts-file='))?.split('=')[1] || '';
const OWNER          = 'KarmaloopAI';
const REPO           = 'Jiva';

function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path:     apiPath,
      method:   'GET',
      headers: {
        // Public repo — no auth needed; add PAT header if rate-limited
        'User-Agent': 'jiva-auto-blogger/2.0',
        'Accept':     'application/vnd.github.v3+json',
        ...(process.env.GITHUB_PAT ? { 'Authorization': `token ${process.env.GITHUB_PAT}` } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Load past posts text and extract any Jiva version strings mentioned.
 * Matches patterns like v0.3.47, 0.3.47, v0.3.47, etc.
 */
function loadCoveredVersions(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Set();
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = content.match(/v?\d+\.\d+\.\d+/g) || [];
  // Normalise: strip leading 'v', store both forms
  const versions = new Set();
  for (const m of matches) {
    const bare = m.replace(/^v/, '');
    versions.add(bare);
    versions.add(`v${bare}`);
  }
  return versions;
}

async function main() {
  const coveredVersions = loadCoveredVersions(PAST_POSTS_ARG);

  let releases;
  try {
    releases = await githubGet(`/repos/${OWNER}/${REPO}/releases?per_page=10`);
  } catch (err) {
    console.error(`Failed to fetch releases: ${err.message}`);
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  const recent = releases.filter(r => {
    const pub = new Date(r.published_at || r.created_at);
    return !r.draft && pub >= cutoff;
  });

  if (recent.length === 0) {
    console.log(`No new Jiva releases in the past ${DAYS} days. Use Priority 2 or 3 topic.`);
    return;
  }

  const newReleases     = [];
  const coveredReleases = [];

  for (const r of recent) {
    if (coveredVersions.has(r.tag_name) || coveredVersions.has(r.tag_name.replace(/^v/, ''))) {
      coveredReleases.push(r);
    } else {
      newReleases.push(r);
    }
  }

  // Report already-covered releases so the agent understands why they're skipped
  for (const r of coveredReleases) {
    const date = (r.published_at || r.created_at).split('T')[0];
    console.log(`ALREADY_COVERED: ${r.tag_name} — released ${date} — "${r.name}" — skip to Priority 2 or 3`);
  }

  if (newReleases.length === 0) {
    if (coveredReleases.length > 0) {
      console.log(`\nAll recent releases have already been blogged about. Use Priority 2 or 3 topic.`);
    }
    return;
  }

  console.log(`\n# New Jiva Releases (past ${DAYS} days — NOT yet blogged)\n`);
  for (const r of newReleases) {
    const date = (r.published_at || r.created_at).split('T')[0];
    console.log(`NEW RELEASE: ${r.tag_name} — released ${date} — "${r.name}"`);
    console.log(`  URL: ${r.html_url}`);
    if (r.body) {
      const teaser = r.body.split('\n').filter(l => l.trim()).slice(0, 3).join(' ');
      console.log(`  Summary: ${teaser.substring(0, 200)}`);
    }
    console.log('');
  }
  console.log(`Use the release notes for full details:`);
  console.log(`  https://raw.githubusercontent.com/${OWNER}/${REPO}/main/docs/release_notes/${newReleases[0].tag_name}.md`);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
