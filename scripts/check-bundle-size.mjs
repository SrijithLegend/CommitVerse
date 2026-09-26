// §12 bundle budgets: landing initial JS ≤ 180 KB gzip; the lazy 3D chunk ≤ 650 KB gzip. Run after `pnpm build`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const next = join(import.meta.dirname, '..', 'apps', 'web', '.next');
const KB = 1024;
const BUDGET = { landing: 180 * KB, lazy: 650 * KB };
const gz = (f) => gzipSync(readFileSync(join(next, f)), { level: 9 }).length;

const manifest = JSON.parse(readFileSync(join(next, 'build-manifest.json'), 'utf8'));
const rsc = readFileSync(join(next, 'server', 'app', 'page_client-reference-manifest.js'), 'utf8');
const entry = JSON.parse(rsc.match(/"entryJSFiles":(\{[^}]*\})/)[1]);
const initial = new Set([...manifest.rootMainFiles, ...entry['[project]/apps/web/app/layout'], ...entry['[project]/apps/web/app/page']]);

const landing = [...initial].reduce((s, f) => s + gz(f), 0);
const lazy = readdirSync(join(next, 'static', 'chunks'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `static/chunks/${f}`)
  .filter((f) => !initial.has(f) && !manifest.polyfillFiles.includes(f))
  .map((f) => ({ f, size: gz(f) }))
  .sort((a, b) => b.size - a.size)[0];

const fmt = (n) => `${(n / KB).toFixed(1)} KB`;
console.log(`landing initial JS: ${fmt(landing)} / ${fmt(BUDGET.landing)}`);
console.log(`largest lazy chunk: ${fmt(lazy.size)} / ${fmt(BUDGET.lazy)} (${lazy.f})`);
if (landing > BUDGET.landing || lazy.size > BUDGET.lazy) {
  console.error('::error::Bundle budget exceeded (§12)');
  process.exit(1);
}
