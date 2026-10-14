# Code-Mode Benchmark Suite

The benchmark measures how well a given **model + configuration** performs in Jiva's
`--code` mode. It runs coding tasks in isolated workspaces and scores them
deterministically with Node's built-in test runner. Use it to compare models
(e.g. `gpt-oss-120b` vs Sarvam-105b vs Krutrim) and to find the optimal setup.

## Suites and the recommended strategy

The benchmark is organised into **suites**, each with a distinct purpose and scoring
mode. List them with `jiva benchmark --list`.

| Suite | Level | Scoring | Purpose | Expectation |
|-------|-------|---------|---------|-------------|
| `taskstore` | baseline | **gating** (binary pass/fail) | Does the model + config do code mode *at all*? | Any usable config ~100% |
| `microcrm` | capability | **scored** (% of spec tests) | Differentiate models/configs; find the *optimal* setup | Strong configs high, weak ones partial |

`microcrm` is a **building** suite (51 tests, 5 tasks): tier 1 builds the base CRM API from
scratch (a large-output test), and tiers 2-5 scaffold the working base and add one harder
feature each — atomic bulk insert, advanced querying, weighted analytics, idempotency-key.
A failed task that hit the model's output-token limit is flagged **`[output-limited]`** in the
report, so an output-cap failure (e.g. a hard 4096-token model) reads distinctly from a logic
failure. Requires Node ≥ 22.5.
| *frontier* (future) | frontier | scored | Ceiling — ~50 tests, even optimal ~30-40%; full pass needs a frontier model | Reuses the scored mechanism |

**Two scoring modes:**
- **gating** — every task is all-or-nothing and tasks build on one another. A single
  number (`highest tier passed`) is the capability ceiling. This is a *gate*: if the
  baseline fails, the config is broken and the other suites' numbers are meaningless.
- **scored** — one (or a few) larger *build-to-spec* task(s) graded by the **fraction
  of spec tests passed**. The headline is the pass-rate, and the report lists exactly
  which spec tests were missed (the capability gaps).

**Recommended workflow:**
1. Run `taskstore` first as a gate on every model/config you care about.
2. Run `microcrm` to score capability; tune configuration (`--max-iterations`,
   reasoning effort, harmony, tool-calling model) and re-run, comparing the pass-rate
   **and** cost (tokens/time) via `--output` JSON reports. The config with the best
   score-per-token is your optimal setup.
3. (Later) Run the frontier suite to see how far a config is from a top-tier model.

> The `microcrm` suite uses the built-in `node:sqlite` module and therefore requires
> **Node ≥ 22.5**. The `taskstore` suite runs on Node ≥ 20.

The rest of this guide describes the `taskstore` (baseline) suite in detail; the
`microcrm` suite works the same way but is graded by pass-rate.

## How it works

- A single evolving Node library (`taskstore`) is the substrate for all tasks.
- Each task is scaffolded into an **isolated temp workspace** containing the
  canonical solution of the prior tiers plus a new **failing** test. Your repo is
  never touched.
- A fresh, minimal `CodeAgent` (no MCP, no persona, no conversation persistence,
  LSP off by default) is pointed at the workspace and given the task prompt.
- After the agent finishes (or times out), the **verifier** runs:
  1. **Tamper check** — every `test/` file must be byte-identical to what was
     scaffolded. Editing a test to make it pass fails the task with
     `tests-modified`.
  2. **`node --test`** — must exit 0 with zero failures.
- Per-task metrics are recorded: pass/fail, iterations (with `!` when the cap was
  hit), tests passed, token usage, and wall-time.

Scoring is cumulative — tier N runs tests `1..N`, so a regression in an earlier
tier (e.g. during the tier-5 refactor) is caught.

## The tiers

| Tier | id | Capability |
|------|----|------------|
| 1 | `t01-create` | Write a new file from scratch |
| 2 | `t02-extend-crud` | Read & extend an existing file |
| 3 | `t03-bugfix-toggle` | Diagnose & fix a targeted bug |
| 4 | `t04-feature-priority` | Multi-function feature |
| 5 | `t05-refactor-split` | Multi-file refactor without regressions |
| 6 | `t06-algorithm-sort` | Algorithmic reasoning & edge cases |
| 7 | `t07-storage-roundtrip` | New module + serialization |
| 8 | `t08-debug-id-collision` | Long-horizon cross-module debugging |

Tiers 5, 7 and 8 demand larger outputs and more iterations — this is where
short-output models (e.g. Sarvam's 4096-token cap) and rate-limited providers
typically break down.

## CLI

```bash
jiva benchmark --list                # list suites and their tasks
jiva benchmark                       # run the taskstore (baseline) suite
jiva benchmark --suite microcrm --max-iterations 60   # run the scored micro-CRM suite
jiva benchmark --max-tier 3          # only tiers 1–3 of the baseline suite
jiva benchmark --tasks t05-refactor-split,t08-debug-id-collision
jiva benchmark --output report.json  # write the full JSON report
jiva benchmark --json                # machine-readable output only
jiva benchmark --continuous          # carry the agent's own output forward between tiers
jiva benchmark --keep-workspaces     # leave temp workspaces on disk for inspection
jiva benchmark -c ./my-config.json   # use a specific config file
```

Other overrides: `--max-iterations`, `--timeout`, `--lsp`.

The command exits non-zero if any task fails, so it works directly in CI. The
output table shows status, iterations, tests, tokens and time per task, plus the
**highest tier passed** as a single capability number.

## HTTP

All routes are under the existing `/api` auth middleware.

```bash
# List tasks
curl -H "x-tenant-id: t1" -H "x-session-id: s1" \
  http://localhost:8080/api/benchmark/tasks

# Run tiers 1–4
curl -X POST http://localhost:8080/api/benchmark/run \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: t1" -H "x-session-id: s1" \
  -d '{"maxTier": 4}'

# Stream progress (Server-Sent Events)
curl -N -X POST http://localhost:8080/api/benchmark/run/stream \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: t1" -H "x-session-id: s1" \
  -d '{"maxTier": 8}'
```

Request body fields: `maxTier`, `tasks` (array of ids), `maxIterations`,
`timeoutMs`, `lsp`, `continuous`. With `AUTH_DISABLED=true` the `x-tenant-id` /
`x-session-id` headers are accepted in dev mode.

## Interpreting results

- **highest tier passed** — the model's capability ceiling. `gpt-oss-120b` should
  reach 8; a constrained model will plateau earlier.
- **`hitMaxIterations` (shown as `!` after the iteration count)** — the agent ran
  out of steps. Common with rate-limited providers and on the debug tier.
- **`reason: tests-failed`** vs **`timeout`** vs **`tests-modified`** vs
  **`agent-error`** — categorises *why* a task failed.
- **tokens / time** — relative cost. A model that passes but burns far more tokens
  or time is a weaker fit for code mode.

## Adding a tier

1. Add the correct implementation snippet(s) to `src/code/benchmark/fixtures.ts`
   and extend `goldenSrcAfter` / `scaffoldSrc`.
2. Add the cumulative `node:test` file to `src/code/benchmark/tests.ts`.
3. Add a `TaskSpec` to `src/code/benchmark/tasks.ts`.
4. Run the self-test to confirm the golden solution passes and the scaffold fails:

```bash
npm run build && node scripts/bench-selftest.mjs
```

The self-test runs 3 checks per tier (golden passes, scaffold fails, tamper
detected) with no LLM involved — keep it green.
