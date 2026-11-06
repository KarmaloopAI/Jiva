import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyCommand } from './bash-readonly.js';

const ro = (c: string) => isReadOnlyCommand(c, 'darwin');

test('read-only commands are accepted', () => {
  for (const c of [
    'ls -la',
    'cat package.json',
    'git status',
    'git diff --staged',
    'git --no-pager log --oneline -5',
    'git -C sub status',
    'git branch',
    'git branch -a',
    'git stash list',
    'rg "foo bar" src',
    'grep -rn TODO src | head -20',
    'find . -name "*.ts" -type f',
    'wc -l src/index.ts',
    'cat a.txt | sort | uniq -c',
  ]) {
    assert.equal(ro(c), true, c);
  }
});

test('mutating, chained or unknown commands are rejected', () => {
  for (const c of [
    'npm test',
    'rm -rf dist',
    'git commit -m x',
    'git branch new-feature',
    'git stash',
    'git checkout main',
    'echo hi > file.txt',
    'cat a >> b',
    'ls; rm x',
    'ls && rm x',
    'ls || rm x',
    'ls & rm x',
    'echo $(rm x)',
    'echo `rm x`',
    'echo ${HOME}',
    'find . -name x -delete',
    'find . -exec rm {} \;',
    'sort -o out.txt in.txt',
    'sort --output=out.txt in.txt',
    'rg --pre ./evil foo',
    'FOO=1 ls',
    'git -c core.pager=evil log',
    'git diff --output=x.patch',
    'git diff --ext-diff',
    'cat < input',
    "echo 'unbalanced",
    'ls\nrm x',
    'grep x | xargs rm',
    '',
  ]) {
    assert.equal(ro(c), false, JSON.stringify(c));
  }
});

test('non-string input and Windows are never read-only', () => {
  assert.equal(isReadOnlyCommand(undefined, 'darwin'), false);
  assert.equal(isReadOnlyCommand(42, 'darwin'), false);
  assert.equal(isReadOnlyCommand('ls', 'win32'), false);
});
