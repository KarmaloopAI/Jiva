/**
 * Edit tool — multi-strategy text replacement with LSP diagnostics.
 *
 * The replacement strategies are ported from opencode (https://github.com/sst/opencode),
 * which in turn sourced them from cline and gemini-cli.
 */

import path from 'path';
import fs from 'fs';
import { createTwoFilesPatch, diffLines } from 'diff';
import { fileLock } from '../file-lock.js';
import type { ICodeTool, CodeToolContext } from './index.js';

const MAX_DIAGNOSTICS = 20;

export const EditFileTool: ICodeTool = {
  name: 'edit_file',
  description: `Replace an exact string in a file with a new string.

REQUIRED PARAMETERS — ALL THREE are mandatory, never omit any:
  • file_path  — absolute path to the file to edit
  • old_string — the EXACT text to find (must match the file exactly)
  • new_string — the REPLACEMENT text (what replaces old_string)

IMPORTANT: You MUST provide BOTH old_string AND new_string in every call.
Omitting new_string will fail with a validation error. new_string is never optional —
it is the text that replaces old_string in the file.

Rules:
- ALWAYS read the file with read_file before editing — never edit blindly.
- old_string must exactly match the file content (whitespace, indentation, line endings).
- Include enough surrounding context in old_string to make the match unique.
- If old_string is empty (""), the file is created with new_string as its content.
- The edit FAILS if old_string is not found in the file — check the content first.
- Use replace_all: true to replace every occurrence of old_string at once.
- Prefer small, targeted edits over rewriting large sections.
- LSP errors (if any) are reported after the edit so you can fix them immediately.

Returns a diff of the changes made, plus any LSP errors detected.`,

  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to replace (empty string to create a new file)',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences of old_string (default: false)',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const rawPath = args.file_path as string;
    const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.workspaceDir, rawPath);
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) ?? false;

    if (oldString === newString) {
      return 'Error: old_string and new_string are identical — no change made.';
    }

    return fileLock.withLock(filePath, async () => {
      let contentBefore = '';
      let contentAfter = '';

      if (oldString === '') {
        // Create / overwrite file
        contentAfter = newString;
        try {
          const dir = path.dirname(filePath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, newString, 'utf-8');
        } catch (e) {
          return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        // Read existing file
        try {
          contentBefore = fs.readFileSync(filePath, 'utf-8');
        } catch {
          return `Error: File not found: ${filePath}`;
        }

        // Normalize line endings for matching
        const ending = detectLineEnding(contentBefore);
        const normalizedOld = convertLineEnding(normalizeLineEndings(oldString), ending);
        const normalizedNew = convertLineEnding(normalizeLineEndings(newString), ending);

        let result: string;
        try {
          result = replace(contentBefore, normalizedOld, normalizedNew, replaceAll);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }

        contentAfter = result;

        try {
          fs.writeFileSync(filePath, contentAfter, 'utf-8');
        } catch (e) {
          return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      // Build diff
      const diff = trimDiff(
        createTwoFilesPatch(
          filePath,
          filePath,
          normalizeLineEndings(contentBefore),
          normalizeLineEndings(contentAfter),
        ),
      );

      // Count changes
      let additions = 0;
      let deletions = 0;
      for (const change of diffLines(contentBefore, contentAfter)) {
        if (change.added) additions += change.count ?? 0;
        if (change.removed) deletions += change.count ?? 0;
      }

      // Notify LSP and collect diagnostics
      let diagnosticsOutput = '';
      try {
        await ctx.lsp.touchFile(filePath);
        const errors = ctx.lsp.getErrorsForFile(filePath);
        if (errors) {
          diagnosticsOutput = `\n\nLSP errors detected — please fix:\n<diagnostics file="${filePath}">\n${errors}\n</diagnostics>`;
        }
      } catch {
        // LSP errors should not block the edit result
      }

      const relPath = path.relative(ctx.workspaceDir, filePath);
      return `Edit applied to ${relPath} (+${additions}/-${deletions} lines).\n\n${diff}${diagnosticsOutput}`;
    });
  },
};

// ─── Replacement Strategies ───────────────────────────────────────────────────
// Ported from opencode (sourced from cline/gemini-cli)

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

function levenshtein(a: string, b: string): number {
  if (a === '' || b === '') return Math.max(a.length, b.length);
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) { matches = false; break; }
    }
    if (matches) {
      let start = 0;
      for (let k = 0; k < i; k++) start += originalLines[k].length + 1;
      let end = start;
      for (let k = 0; k < searchLines.length; k++) {
        end += originalLines[i + k].length;
        if (k < searchLines.length - 1) end += 1;
      }
      yield content.substring(start, end);
    }
  }
};

const SINGLE_CANDIDATE_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_THRESHOLD = 0.3;

const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines.length < 3) return;
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  const firstLine = searchLines[0].trim();
  const lastLine = searchLines[searchLines.length - 1].trim();

  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLine) continue;
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLine) { candidates.push({ startLine: i, endLine: j }); break; }
    }
  }
  if (candidates.length === 0) return;

  const computeSimilarity = (startLine: number, endLine: number): number => {
    const actualSize = endLine - startLine + 1;
    const linesToCheck = Math.min(searchLines.length - 2, actualSize - 2);
    if (linesToCheck <= 0) return 1.0;
    let sim = 0;
    for (let j = 1; j < searchLines.length - 1 && j < actualSize - 1; j++) {
      const orig = originalLines[startLine + j].trim();
      const srch = searchLines[j].trim();
      const maxLen = Math.max(orig.length, srch.length);
      if (maxLen === 0) continue;
      sim += (1 - levenshtein(orig, srch) / maxLen) / linesToCheck;
      if (sim >= SINGLE_CANDIDATE_THRESHOLD) break;
    }
    return sim;
  };

  const extractMatch = (startLine: number, endLine: number): string => {
    let start = 0;
    for (let k = 0; k < startLine; k++) start += originalLines[k].length + 1;
    let end = start;
    for (let k = startLine; k <= endLine; k++) {
      end += originalLines[k].length;
      if (k < endLine) end += 1;
    }
    return content.substring(start, end);
  };

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    if (computeSimilarity(startLine, endLine) >= SINGLE_CANDIDATE_THRESHOLD) {
      yield extractMatch(startLine, endLine);
    }
    return;
  }

  let best: { startLine: number; endLine: number } | null = null;
  let maxSim = -1;
  for (const { startLine, endLine } of candidates) {
    const sim = computeSimilarity(startLine, endLine);
    if (sim > maxSim) { maxSim = sim; best = { startLine, endLine }; }
  }
  if (maxSim >= MULTIPLE_CANDIDATES_THRESHOLD && best) {
    yield extractMatch(best.startLine, best.endLine);
  }
};

const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const normalizedFind = norm(find);
  const lines = content.split('\n');

  for (const line of lines) {
    if (norm(line) === normalizedFind) { yield line; continue; }
    const normLine = norm(line);
    if (normLine.includes(normalizedFind)) {
      const words = find.trim().split(/\s+/);
      if (words.length > 0) {
        const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        try {
          const m = line.match(new RegExp(pattern));
          if (m) yield m[0];
        } catch { /* invalid regex */ }
      }
    }
  }

  const findLines = find.split('\n');
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length);
      if (norm(block.join('\n')) === normalizedFind) yield block.join('\n');
    }
  }
};

const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndent = (text: string) => {
    const lines = text.split('\n');
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) return text;
    const min = Math.min(...nonEmpty.map((l) => { const m = l.match(/^(\s*)/); return m ? m[1].length : 0; }));
    return lines.map((l) => (l.trim().length === 0 ? l : l.slice(min))).join('\n');
  };
  const normalizedFind = removeIndent(find);
  const contentLines = content.split('\n');
  const findLines = find.split('\n');
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n');
    if (removeIndent(block) === normalizedFind) yield block;
  }
};

const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescape = (s: string) =>
    s.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (_, c) => {
      switch (c) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case '\\': return '\\';
        case '\n': return '\n';
        default: return c;
      }
    });
  const unescapedFind = unescape(find);
  if (content.includes(unescapedFind)) { yield unescapedFind; return; }
  const lines = content.split('\n');
  const findLines = unescapedFind.split('\n');
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');
    if (unescape(block) === unescapedFind) yield block;
  }
};

const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim();
  if (trimmedFind === find) return;
  if (content.includes(trimmedFind)) { yield trimmedFind; return; }
  const lines = content.split('\n');
  const findLines = find.split('\n');
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');
    if (block.trim() === trimmedFind) yield block;
  }
};

const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split('\n');
  if (findLines.length < 3) return;
  if (findLines[findLines.length - 1] === '') findLines.pop();
  const contentLines = content.split('\n');
  const firstLine = findLines[0].trim();
  const lastLine = findLines[findLines.length - 1].trim();

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue;
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() !== lastLine) continue;
      const blockLines = contentLines.slice(i, j + 1);
      if (blockLines.length !== findLines.length) break;
      let matching = 0;
      let total = 0;
      for (let k = 1; k < blockLines.length - 1; k++) {
        const b = blockLines[k].trim();
        const f = findLines[k].trim();
        if (b.length > 0 || f.length > 0) { total++; if (b === f) matching++; }
      }
      if (total === 0 || matching / total >= 0.5) {
        yield blockLines.join('\n');
        break;
      }
      break;
    }
  }
};

const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let start = 0;
  while (true) {
    const idx = content.indexOf(find, start);
    if (idx === -1) break;
    yield find;
    start = idx + find.length;
  }
};

/** Apply the first matching replacement strategy. */
export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) throw new Error('No changes: old_string and new_string are identical.');

  let notFound = true;

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const idx = content.indexOf(search);
      if (idx === -1) continue;
      notFound = false;
      if (replaceAll) return content.replaceAll(search, newString);
      const lastIdx = content.lastIndexOf(search);
      if (idx !== lastIdx) continue; // ambiguous match
      return content.substring(0, idx) + newString + content.substring(idx + search.length);
    }
  }

  if (notFound) {
    throw new Error(
      'Could not find old_string in the file. It must match exactly (whitespace, indentation, line endings).',
    );
  }
  throw new Error('Found multiple matches for old_string. Provide more surrounding context to make it unique.');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function normalizeLineEndings(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

function detectLineEnding(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function convertLineEnding(text: string, ending: '\n' | '\r\n'): string {
  return ending === '\n' ? text : text.replaceAll('\n', '\r\n');
}

function trimDiff(diff: string): string {
  const lines = diff.split('\n');
  const contentLines = lines.filter(
    (l) => (l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')) &&
      !l.startsWith('---') && !l.startsWith('+++'),
  );
  if (contentLines.length === 0) return diff;

  let min = Infinity;
  for (const line of contentLines) {
    const content = line.slice(1);
    if (content.trim().length > 0) {
      const m = content.match(/^(\s*)/);
      if (m) min = Math.min(min, m[1].length);
    }
  }
  if (min === Infinity || min === 0) return diff;

  return lines.map((line) => {
    if ((line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) &&
        !line.startsWith('---') && !line.startsWith('+++')) {
      return line[0] + line.slice(1 + min);
    }
    return line;
  }).join('\n');
}
