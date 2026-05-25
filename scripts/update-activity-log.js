#!/usr/bin/env node
/**
 * Autoblogger Activity Log Writer
 *
 * Appends a structured entry to the monthly activity log stored in the
 * gritsa/www-gritsa.github.io repo under _autoblogger-logs/YYYY-MM.md
 *
 * Jekyll ignores underscore-prefixed directories so this file is never
 * published to the public website, but remains version-controlled and
 * browsable on GitHub.
 *
 * Usage:
 *   node update-activity-log.js --action=blog_post \
 *     --title="Post Title" --url="https://..." \
 *     --topic="jiva_release|anthropic|general" \
 *     --image="yes|no|fallback"
 *
 *   node update-activity-log.js --action=skipped \
 *     --reason="Already posted today"
 *
 * Exit codes:
 *   0 — success
 *   1 — network/API error (non-fatal — caller should warn but continue)
 */
'use strict';

const https = require('https');

const GITHUB_PAT  = process.env.GITHUB_PAT || process.env.GRITSA_GITHUB_PAT || '';
const REPO_OWNER  = 'gritsa';
const REPO_NAME   = 'www-gritsa.github.io';
const LOG_DIR     = '_autoblogger-logs';

// ── Parse CLI args ─────────────────────────────────────────────────────────
function getArg(name) {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : '';
}

// ── Date helpers ──────────────────────────────────────────────────────────
function nowIST() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().replace('T', ' ').substring(0, 16) + ' IST';
}

function monthKey() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().substring(0, 7); // YYYY-MM
}

// ── GitHub API helpers ────────────────────────────────────────────────────
function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path:     apiPath,
      method,
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'User-Agent':    'jiva-auto-blogger/2.0',
        'Accept':        'application/vnd.github.v3+json',
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Build log entry markdown ───────────────────────────────────────────────
function buildEntry(action, args) {
  const ts = nowIST();
  if (action === 'skipped') {
    const reason = args.reason || 'No reason given';
    return `\n## ${ts}\n- **Action**: skipped\n- **Reason**: ${reason}\n`;
  }
  if (action === 'blog_post') {
    const title   = args.title   || '(no title)';
    const url     = args.url     || '(no url)';
    const topic   = args.topic   || 'unknown';
    const image   = args.image   || 'unknown';
    return [
      `\n## ${ts}`,
      `- **Action**: blog_post`,
      `- **Title**: ${title}`,
      `- **URL**: ${url}`,
      `- **Topic type**: ${topic}`,
      `- **Image**: ${image}`,
      '',
    ].join('\n');
  }
  // Generic action
  return `\n## ${ts}\n- **Action**: ${action}\n`;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const action = getArg('action') || 'unknown';
  const args   = {
    title:  getArg('title'),
    url:    getArg('url'),
    topic:  getArg('topic'),
    image:  getArg('image'),
    reason: getArg('reason'),
  };

  const month   = monthKey();
  const filePath = `${LOG_DIR}/${month}.md`;
  const apiPath  = `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

  const newEntry = buildEntry(action, args);

  // Read existing file (if any) to get SHA and current content
  let existingContent = `# Autoblogger Activity Log — ${month}\n`;
  let existingSha     = null;

  const getRes = await githubRequest('GET', apiPath);
  if (getRes.status === 200 && getRes.body.content) {
    existingContent = Buffer.from(getRes.body.content, 'base64').toString('utf8');
    existingSha     = getRes.body.sha;
  }

  const updatedContent = existingContent.trimEnd() + '\n' + newEntry;
  const b64Content     = Buffer.from(updatedContent, 'utf8').toString('base64');

  const putRes = await githubRequest('PUT', apiPath, {
    message:  `log: autoblogger ${action} — ${month}`,
    content:  b64Content,
    branch:   'main',
    ...(existingSha ? { sha: existingSha } : {}),
  });

  if (putRes.status >= 200 && putRes.status < 300) {
    console.log(`✅ Activity log updated: ${filePath} (${action})`);
  } else {
    console.error(`❌ Failed to update activity log: HTTP ${putRes.status}`, JSON.stringify(putRes.body).slice(0, 200));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`❌ Activity log error: ${err.message}`);
  process.exit(1);
});
