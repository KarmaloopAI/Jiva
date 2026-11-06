# Agentic Pipeline Playbook

A reusable architecture for building reliable, production-grade AI workflows with Jiva.

---

## The Core Problem This Solves

LLM agents fail in predictable ways when asked to do too much in one session:

- **Multi-step data gathering** — the model calls tools correctly but then synthesises results from memory rather than incorporating actual tool outputs, producing empty templates or hallucinated values
- **Split gather/write tasks** — if the manager breaks data collection and file writing into separate subtasks, the second worker has no memory of what the first gathered
- **Unstructured output** — asking a model to produce formatted files (JSON, Python, PPTX) end-to-end results in syntactically broken or stub outputs
- **Silent failures** — scripts fail, agents time out, APIs rate-limit; without a recovery loop the entire pipeline dies

This playbook describes a three-layer architecture that sidesteps all of these failure modes.

---

## The Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: DETERMINISTIC DATA COLLECTION                 │
│  Scripts that call APIs, query databases, transform     │
│  data — no LLM involved. Output: structured JSON.       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  LAYER 2: BOUNDED AI INTELLIGENCE                       │
│  Jiva agent with a single, tight brief: read one        │
│  structured file, write one structured file.            │
│  Produces: narrative, insights, scored recommendations. │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  LAYER 3: DETERMINISTIC OUTPUT GENERATION               │
│  Script that reads both data + intelligence files and   │
│  assembles the final artefact (report, dashboard, API   │
│  payload, email, etc). Reliable, pixel-perfect, fast.  │
└─────────────────────────────────────────────────────────┘
```

Each layer has one job. Layers communicate via files in a `workspace/` directory, never via agent memory.

---

## Layer 1 — Deterministic Data Collection

### What goes here
- Database queries (SQL, MongoDB, BigQuery)
- External API calls (REST, GraphQL, scraping)
- File parsing (CSV, Excel, PDF extraction)
- Geocoding, routing, pricing feeds
- Any operation with a right/wrong answer

### How to build it
Write a standalone script (`gather-data.js`, `fetch-records.py`, etc.) that:

1. Accepts input parameters via CLI flags (`--lat`, `--id`, `--date-range`)
2. Reads credentials from `.env` — never hardcoded
3. Executes all data operations sequentially or in parallel
4. Writes a single structured JSON file to `workspace/`
5. Logs progress clearly so failures are diagnosable
6. Exits non-zero on any unrecoverable error

```
scripts/
  gather-data.js       ← all data collection
  build-output.py      ← all output assembly
```

### What NOT to put here
Do not use the LLM for any data collection step that has a deterministic answer. If a SQL query can fetch it, fetch it. If an API can return it, call the API. Reserve the model for tasks where judgment is required.

### Native module pitfall
On Node.js, avoid native addons (`better-sqlite3`, `canvas`, etc.) that require compilation. Use CLI tools instead:

```javascript
// Instead of: require('better-sqlite3')
const { execSync } = require('child_process');
function sqliteQuery(sql) {
  return JSON.parse(
    execSync(`/usr/bin/sqlite3 -json "${DB_PATH}" '${sql}'`, { encoding: 'utf8' }) || '[]'
  );
}
```

This eliminates `NODE_MODULE_VERSION` mismatches entirely.

---

## Layer 2 — Bounded AI Intelligence

### The single-task rule

The agent must have exactly **one input file** and **one output file**. No web search, no database queries, no multi-step pipelines. Its only tools are filesystem read and write.

If you find yourself wanting the agent to do more than read + reason + write, split it into two passes or move that step to Layer 1.

### What the agent actually contributes
- **Narrative generation** — converting numbers into readable prose
- **Insight synthesis** — finding patterns across multiple data points ("property A is 12% above the benchmark")
- **Scoring and ranking** — applying judgment to structured data
- **Anomaly flagging** — identifying what's unusual or missing and why it matters
- **Tone and framing** — tailoring language for a specific audience

### Directive design
The directive should be tight and output-schema-driven:

```markdown
# Purpose
You are a [role]. You read [input file]. You write [output file].
You do not search the web. You do not call external APIs.

# Output schema
Write workspace/intelligence.json with this exact structure:
{
  "section_a": "<2-3 sentences doing X>",
  "section_b": "<3-4 sentences doing Y>",
  ...
}

# Rules
- Use only data present in the input file — do not invent figures
- Write in [tone/style]
- Your task is complete once the file has been written
```

### Config
Filesystem MCP only. No SQLite, no Tavily, no shell:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{WORKSPACE_DIR}}"],
      "enabled": true
    }
  }
}
```

### Handling failure
The AI step is **non-fatal**. If it fails or produces malformed output, Layer 3 degrades gracefully — it renders data labels and omits narrative slots rather than crashing. This is the correct behaviour; a report with accurate data but no narrative is better than no report at all.

---

## Layer 3 — Deterministic Output Generation

### What goes here
- Report/document assembly (PPTX, PDF, DOCX, HTML)
- Dashboard data formatting
- Email/notification composition from templates
- API response construction
- Any operation that should produce identical output given identical inputs

### How to build it
Write a script that:

1. Reads `workspace/data.json` (Layer 1 output)
2. Reads `workspace/intelligence.json` (Layer 2 output) — with graceful fallback if absent
3. Assembles the final artefact
4. Validates output (file exists, size > threshold, required fields populated)

```python
# Always load intelligence with fallback
narrative = {}
if os.path.exists(NARRATIVE_PATH):
    with open(NARRATIVE_PATH) as f:
        narrative = json.load(f)

def narr(key, fallback=''):
    return narrative.get(key) or fallback
```

---

## The Self-Healing Feedback Loop

Wrap Layers 1 and 3 (the deterministic scripts) in a retry loop with a Jiva code agent as the repair mechanism:

```
run script
    │
    ├── success → continue
    │
    └── failure
            │
            ├── write error context to .self-heal-error.txt
            │
            ├── invoke: jiva run "Fix the script at PATH.
            │                    Error details at .self-heal-error.txt.
            │                    Edit the script to fix the bug.
            │                    Do not run it — just fix the code."
            │                    --code --no-lsp --max-iterations 10
            │
            └── retry script (up to N times)
```

### Why code mode
`--code` mode gives Jiva the file editing tools (`Read`, `Edit`, `Write`, `Bash`) as a single agent loop. It doesn't need a manager/worker split for a focused repair task. `--no-lsp` avoids LSP startup overhead for short repair tasks.

### What the repair prompt should include
- The path to the failing script (not the contents — the agent will read it)
- The path to the error file (stderr + stdout tail)
- Explicit instruction not to run the script (the orchestrator retries it)
- A clear success criterion ("confirm which lines you changed and why")

### Error context file
```javascript
fs.writeFileSync('.self-heal-error.txt', [
  `Script: ${scriptPath}`,
  `Error:  ${errorMessage}`,
  '',
  '── STDERR ──',
  stderr.slice(-3000),
  '',
  '── STDOUT (tail) ──',
  stdout.slice(-2000),
].join('\n'));
```

### Retry limits
Two self-heal attempts is usually sufficient. Three is the maximum before you should abort and alert — infinite retry loops on broken scripts waste API credits and mask root causes.

---

## Orchestrator Pattern

```javascript
// orchestrator.js skeleton

// Phase 0: Environment & pre-flight checks
loadEnv();
ensureDatabase();
ensureDirs();

// Phase 1: Data collection (deterministic + self-healing)
runWithSelfHealing({
  binary: 'node',
  scriptArgs: ['scripts/gather-data.js', '--id', args.id],
  label: 'gather-data.js',
  maxRetries: 2,
});
validateDataOutput();  // abort if output file is missing or malformed

// Phase 2: AI intelligence (bounded, non-fatal)
try {
  runJiva({
    prompt: 'Read workspace/data.json. Write workspace/intelligence.json. Follow directive.',
    configPath: 'agents/intelligence-writer/config.json',
    directivePath: 'agents/intelligence-writer/directive.md',
    workspacePath: WORKSPACE_DIR,
    maxIterations: 8,
  });
} catch (e) {
  console.warn('AI step failed — continuing without narrative');
}

// Phase 3: Output assembly (deterministic + self-healing)
runWithSelfHealing({
  binary: 'python3',
  scriptArgs: ['scripts/build-output.py', '--workspace', WORKSPACE_DIR],
  label: 'build-output.py',
  maxRetries: 2,
});
validateFinalOutput();  // abort if artefact is missing or too small
```

---

## Workspace Layout

Every client project should use this layout:

```
client-project/
├── .env                          # API keys — never committed
├── .env.example                  # Template — committed
├── .runtime/                     # Interpolated configs — never committed
│   └── *.runtime.json
├── agents/
│   └── intelligence-writer/
│       ├── config.json           # MCP config template (uses {{PLACEHOLDERS}})
│       └── directive.md          # Agent brief
├── data/                         # Source data (DB files, reference CSVs)
├── scripts/
│   ├── gather-data.js            # Layer 1: data collection
│   └── build-output.py           # Layer 3: output assembly
├── workspace/                    # Runtime artefacts — gitignored
│   ├── data.json                 # Layer 1 output
│   ├── intelligence.json         # Layer 2 output
│   ├── .self-heal-error.txt      # Transient — self-healing context
│   └── output/                   # Final deliverables
└── orchestrator.js               # Pipeline controller
```

---

## Agent Configuration Template

```json
{
  "models": {
    "reasoning": {
      "endpoint": "{{LLM_ENDPOINT}}",
      "apiKey": "{{LLM_API_KEY}}",
      "defaultModel": "llama-3.3-70b-versatile",
      "useHarmonyFormat": false
    }
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "{{WORKSPACE_DIR}}"],
      "enabled": true
    }
  }
}
```

Only add MCP servers that the agent's task actually requires. An intelligence-writing agent needs filesystem only. A data-gathering agent needs SQLite, Tavily, Maps. Never give an agent capabilities it does not need.

---

## Decision Guide: AI vs Deterministic

| Task | Use |
|------|-----|
| Database query | Deterministic |
| REST API call | Deterministic |
| File format conversion | Deterministic |
| Document/report assembly | Deterministic |
| Geocoding / routing | Deterministic |
| **Writing narrative from numbers** | **AI** |
| **Interpreting patterns across data points** | **AI** |
| **Scoring or ranking with judgment** | **AI** |
| **Flagging anomalies and explaining why** | **AI** |
| **Tailoring tone for an audience** | **AI** |
| **Synthesising an executive summary** | **AI** |
| Calculating a percentage | Deterministic |
| Extracting a field from structured JSON | Deterministic |

**Rule of thumb:** if a junior developer could write the code in under 10 minutes, it should be deterministic. If it requires reading between the lines of data, it belongs to the AI.

---

## Common Failure Modes and Fixes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Agent writes empty/template JSON | Agent ran tools but synthesised from memory when writing | Move data collection to Layer 1; agent only reads a pre-built file |
| Agent splits gather+write into 2 subtasks, second has no data | Manager planning splits naturally sequential tasks | Directive must state: "gather AND write in a single session" |
| `reasoning_effort not supported` error | Model is non-reasoning but config passes `reasoningEffort` | Set `defaultReasoningEffort: null` in config; only reasoning models support this param |
| Native module version mismatch | `better-sqlite3` compiled against different Node version | Replace with `sqlite3` CLI via `execSync` |
| MCP servers don't connect in spawned subprocess | `npx`/`node` not in PATH of spawned process | Explicitly set PATH in `spawnSync` env: include `/usr/local/bin`, npm global bin, system bin |
| PPTX/output file is 0 bytes | Agent wrote stub Python script but never executed it | Move output assembly to a deterministic Layer 3 script |
| Narrative is all "no data available" | AI agent had 0 tools (MCP failed to connect) | Fix PATH; verify npx is resolvable in subprocess env |
| Self-healing loop runs indefinitely | maxRetries not enforced | Always cap at 2–3 retries and abort with clear error message |

---

## Checklist for a New Client

- [ ] Identify all data sources (DBs, APIs, files) — assign each to Layer 1
- [ ] Identify all output artefacts (reports, payloads, emails) — assign each to Layer 3
- [ ] Define what judgment/narrative the AI will add — write the directive schema
- [ ] Write `gather-data` script: CLI flags, `.env` keys, JSON output schema
- [ ] Write `build-output` script: accepts `workspace/data.json` + optional `workspace/intelligence.json`
- [ ] Create `agents/intelligence-writer/` with filesystem-only config and tight directive
- [ ] Wire orchestrator with `runWithSelfHealing` around Layers 1 and 3
- [ ] Make Layer 2 non-fatal (catch and continue if AI step fails)
- [ ] Validate output at each phase boundary — abort early with a clear message
- [ ] Test with coordinates/IDs that have full data coverage before demoing
- [ ] Confirm `node`, `npx`, `python3`, and `jiva` are all resolvable from subprocess PATH
