/**
 * Copy non-TypeScript benchmark assets (the micro-CRM test + reference `.mjs`
 * files) into dist, since `tsc` only emits compiled TypeScript. Run after `tsc`.
 */
import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const copies = [
  ['src/code/benchmark/microcrm/assets', 'dist/code/benchmark/microcrm/assets'],
];

for (const [src, dst] of copies) {
  if (!existsSync(src)) continue;
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[copy-benchmark-assets] ${src} -> ${dst}`);
}
