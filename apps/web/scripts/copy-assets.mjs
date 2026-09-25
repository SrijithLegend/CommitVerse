// Self-hosts detect-gpu's benchmark tables (CSP: no third-party connect-src needed).
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve('detect-gpu/package.json')), 'dist', 'benchmarks');
mkdirSync('public/detect-gpu', { recursive: true });
cpSync(src, 'public/detect-gpu', { recursive: true });
console.log('copied detect-gpu benchmarks');
