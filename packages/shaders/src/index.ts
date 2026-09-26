/** Shader library (§5.3). Materials are GLSL strings with `#include <chunk>` resolved against CHUNKS (plus three's own chunks). */
import { CHUNKS } from './chunks';

export { CHUNKS } from './chunks';
export * from './far';
export * from './fx';
export * from './near';
export * from './planet';
export * from './post';

/** Resolves our #include chunks; unknown includes are left for three.js to resolve (e.g. <logdepthbuf_vertex>). */
export function glsl(src: string): string {
  const seen = new Set<string>();
  const resolve = (s: string): string =>
    s.replace(/^[ \t]*#include\s+<([\w]+)>/gm, (m, name: string) => {
      const chunk = CHUNKS[name];
      if (!chunk) return m;
      if (seen.has(name)) return '';
      seen.add(name);
      return resolve(chunk);
    });
  return resolve(src);
}
