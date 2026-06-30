/**
 * Report formatting for benchmark results — a chalk table for the CLI and a
 * plain JSON serializer for files / HTTP.
 */

import chalk from 'chalk';
import type { SuiteResult, TaskResult } from './types.js';

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function statusCell(r: TaskResult): string {
  if (r.passed) return chalk.green('PASS');
  const reason = r.reason ?? 'fail';
  return chalk.red('FAIL') + chalk.gray(` ${reason}`);
}

export function formatReportForCLI(suite: SuiteResult): string {
  const lines: string[] = [];
  lines.push('');
  const scored = suite.scoring === 'scored';
  lines.push(chalk.bold(`  Jiva Code-Mode Benchmark — ${suite.suiteName ?? 'taskstore'}`));
  if (suite.model) lines.push(chalk.gray(`  Model: ${suite.model}`));
  lines.push(chalk.gray(`  ${suite.startedAt} → ${suite.finishedAt}`));
  lines.push('');

  // Header
  lines.push(
    chalk.gray(
      '  ' +
        pad('Tier', 5) +
        pad('Task', 26) +
        pad('Status', 18) +
        pad('Iters', 7) +
        pad('Tests', 9) +
        pad('Tokens', 10) +
        'Time',
    ),
  );
  lines.push(chalk.gray('  ' + '─'.repeat(86)));

  for (const r of suite.tasks) {
    const iters = `${r.iterations}${r.hitMaxIterations ? '!' : ''}`;
    const tests = `${r.testsPassed}/${r.testsPassed + r.testsFailed}`;
    const tokens = r.tokenUsage?.totalTokens ? String(r.tokenUsage.totalTokens) : '-';
    lines.push(
      '  ' +
        pad(String(r.tier), 5) +
        pad(r.title, 26) +
        pad(statusCell(r), 18 + 10) + // +10 to absorb chalk color codes width
        pad(iters, 7) +
        pad(tests, 9) +
        pad(tokens, 10) +
        fmtMs(r.wallTimeMs),
    );
  }

  lines.push(chalk.gray('  ' + '─'.repeat(86)));

  if (scored) {
    // Headline for scored suites is the spec-test pass-rate, not all-or-nothing.
    const score = `${suite.totalTestsPassed}/${suite.totalTestsRun} tests (${suite.scorePct}%)`;
    const colour = suite.scorePct >= 90 ? chalk.green : suite.scorePct >= 50 ? chalk.yellow : chalk.red;
    lines.push(colour(`  Score: ${score}`));
  } else {
    const ratio = `${suite.passed}/${suite.totalTasks}`;
    const summary =
      suite.passed === suite.totalTasks ? chalk.green(`  ${ratio} passed`) : chalk.yellow(`  ${ratio} passed`);
    lines.push(summary + chalk.gray(`  ·  highest tier passed: ${suite.highestTierPassed}`));
  }
  lines.push(
    chalk.gray(
      `  total time: ${fmtMs(suite.totalWallTimeMs)}` +
        (suite.totalTokens ? `  ·  total tokens: ${suite.totalTokens}` : ''),
    ),
  );

  // Scored suites: list the specific spec tests the model missed (the capability gaps).
  if (scored) {
    const missed = suite.tasks.flatMap((t) => t.failingTests ?? []);
    if (missed.length > 0) {
      lines.push('');
      lines.push(chalk.bold(`  Missed (${missed.length})`));
      for (const name of missed) lines.push(chalk.red('  ✗ ') + chalk.gray(name));
    }
  }

  // Output-length limitation flag: failures driven by output-token truncation are a
  // model capacity limit (e.g. a hard 4096-token cap), distinct from a logic gap.
  const outputLimited = suite.tasks.filter((t) => t.outputLimited);
  if (outputLimited.length > 0) {
    lines.push('');
    lines.push(chalk.yellow('  ⚠ Output-length limited') +
      chalk.gray(`  — ${outputLimited.length} task(s) failed after hitting the model's output-token limit:`));
    for (const t of outputLimited) {
      lines.push(chalk.gray(`      ${t.id} (${t.truncationEvents}× truncation) — couldn't emit a large enough response`));
    }
  }

  // Surface failures with their diagnostic notes (infra/agent errors, not per-test).
  const failures = suite.tasks.filter((t) => !t.passed);
  if (failures.length > 0) {
    lines.push('');
    lines.push(chalk.bold('  Failures'));
    for (const f of failures) {
      const tag = f.outputLimited ? chalk.yellow(' [output-limited]') : '';
      lines.push(chalk.red(`  • ${f.id}`) + chalk.gray(` (${f.reason ?? 'fail'})`) + tag);
      if (f.notes) lines.push(chalk.gray(`    ${f.notes}`));
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function toReportJSON(suite: SuiteResult): string {
  return JSON.stringify(suite, null, 2);
}
