/**
 * Universe tile storage (§6.4). Production: Cloudflare R2 (S3 API) — immutable, versioned paths, brotli.
 * Local mode: files under DATA_DIR/tiles, served by the web app's /u/[...path] route.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { repoRoot } from '@commitverse/db';

export interface PutOptions {
  contentType: string;
  cacheControl: string;
  brotli?: boolean;
}

export interface ObjectStore {
  kind: 'r2' | 'local';
  put(key: string, body: Uint8Array | string, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Top-level "directories" directly under a prefix, e.g. versions under "u/". */
  listPrefixes(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<number>;
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const SHORT = 'public, max-age=60';

const toBytes = (b: Uint8Array | string) => (typeof b === 'string' ? new TextEncoder().encode(b) : b);
const br = (b: Uint8Array) => new Uint8Array(brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));

export function localDataDir(): string {
  const d = process.env.DATA_DIR ?? join(repoRoot(), '.data');
  return d === ':memory:' ? join(repoRoot(), '.data-test') : d;
}

export function createLocalStore(root = join(localDataDir(), 'tiles')): ObjectStore {
  const safe = (key: string) => {
    if (key.includes('..') || key.startsWith('/')) throw new Error('bad key');
    return join(root, key);
  };
  return {
    kind: 'local',
    async put(key, body) {
      const p = safe(key);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, toBytes(body));
    },
    async get(key) {
      const p = safe(key);
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    },
    async listPrefixes(prefix) {
      const p = safe(prefix);
      if (!existsSync(p)) return [];
      return readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `${prefix}${d.name}/`);
    },
    async deletePrefix(prefix) {
      const p = safe(prefix);
      if (!existsSync(p)) return 0;
      rmSync(p, { recursive: true, force: true });
      return 1;
    },
  };
}

export async function createR2Store(): Promise<ObjectStore> {
  const { AwsClient } = await import('aws4fetch');
  const account = process.env.R2_ACCOUNT_ID!;
  const bucket = process.env.R2_BUCKET!;
  const aws = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  });
  const base = `https://${account}.r2.cloudflarestorage.com/${bucket}`;
  const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');
  const listKeys = async (prefix: string, delimiter?: string) => {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const q = new URLSearchParams({
        'list-type': '2',
        prefix,
        ...(delimiter ? { delimiter } : {}),
        ...(token ? { 'continuation-token': token } : {}),
      });
      const res = await aws.fetch(`${base}?${q}`);
      if (!res.ok) throw new Error(`R2 list failed: ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]!);
      for (const m of xml.matchAll(/<CommonPrefixes><Prefix>([^<]+)<\/Prefix><\/CommonPrefixes>/g)) prefixes.push(m[1]!);
      token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    } while (token);
    return { keys, prefixes };
  };
  return {
    kind: 'r2',
    async put(key, body, opts) {
      const raw = toBytes(body);
      const data = opts.brotli ? br(raw) : raw;
      const headers: Record<string, string> = { 'content-type': opts.contentType, 'cache-control': opts.cacheControl };
      if (opts.brotli) headers['content-encoding'] = 'br';
      for (let attempt = 0; ; attempt++) {
        const res = await aws.fetch(`${base}/${enc(key)}`, { method: 'PUT', headers, body: data as unknown as BodyInit });
        if (res.ok) return;
        if (attempt >= 4) throw new Error(`R2 put ${key} failed: ${res.status}`);
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    },
    async get(key) {
      const res = await aws.fetch(`${base}/${enc(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 get ${key} failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async listPrefixes(prefix) {
      return (await listKeys(prefix, '/')).prefixes;
    },
    async deletePrefix(prefix) {
      const { keys } = await listKeys(prefix);
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        const body = `<Delete>${chunk.map((k) => `<Object><Key>${k.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Key></Object>`).join('')}</Delete>`;
        const md5 = createHash('md5').update(body).digest('base64');
        const res = await aws.fetch(`${base}?delete`, {
          method: 'POST',
          body,
          headers: { 'content-md5': md5, 'content-type': 'application/xml' },
        });
        if (!res.ok) throw new Error(`R2 delete failed: ${res.status}`);
      }
      return keys.length;
    },
  };
}

let store: Promise<ObjectStore> | undefined;
export function getStore(): Promise<ObjectStore> {
  store ??= process.env.R2_BUCKET ? createR2Store() : Promise.resolve(createLocalStore());
  return store;
}
