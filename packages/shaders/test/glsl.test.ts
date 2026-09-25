import { describe, expect, it } from 'vitest';
import * as S from '../src';

describe('shader library', () => {
  it('resolves every #include chunk and leaves no unknown cv_ includes', () => {
    for (const [name, src] of Object.entries(S)) {
      if (typeof src !== 'string') continue;
      const out = S.glsl(src);
      expect(out, name).not.toMatch(/#include\s+<cv_/);
      // balanced braces
      expect((out.match(/{/g) ?? []).length, name).toBe((out.match(/}/g) ?? []).length);
    }
  });
  it('includes a chunk only once', () => {
    const out = S.glsl('#include <cv_noise>\n#include <cv_noise>\n');
    expect(out.match(/float snoise\(vec3 v\)/g)).toHaveLength(1);
  });
});
