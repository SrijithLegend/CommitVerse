import { mulberry32 } from '@commitverse/universe-core';
import { describe, expect, it } from 'vitest';
import { type EmbedInput, renderEmbed, xmlEscape } from '../src';

const base: EmbedInput = {
  login: 'nova-dev',
  name: 'Nova Dev',
  temperature: 5710,
  spectralClass: 'G',
  subclass: 'G3',
  state: 'main',
  radius: 4.7,
  cTotal: 4213,
  c30: 38,
  starsTotal: 2110,
  galaxy: 'Python',
  planets: [{ color: '#3572a5', orbit: 12, period: 20, size: 0.5 }],
  pulsar: true,
};

const PAYLOADS = [
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  "'><img src=x onerror=alert(1)>",
  ']]><script>x</script>',
  '<![CDATA[<script>]]>',
  '&lt;script&gt;',
  'javascript:alert(1)',
  '<foreignObject><iframe src="https://evil"/></foreignObject>',
  '‮evil‬',
  '\u0000\u0001<',
  '</text><a href="https://evil">x</a>',
  '<style>*{background:url(https://evil)}</style>',
];

/** Tags present in a well-formed card; anything else means injected markup. */
const ALLOWED_TAGS = new Set(['svg', 'title', 'style', 'defs', 'radialGradient', 'stop', 'rect', 'circle', 'g', 'path', 'text']);

function assertSafe(svg: string) {
  for (const m of svg.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)) expect(ALLOWED_TAGS.has(m[1]!)).toBe(true);
  for (const raw of svg.match(/<[^>]+>/g) ?? []) {
    const tag = raw.replace(/"[^"]*"/g, '""');
    expect(tag).not.toMatch(/\son[a-z]+\s*=/i);
    expect(tag).not.toMatch(/href\s*=/i);
  }
  expect(svg).not.toMatch(/<script/i);
  expect(svg.match(/<style>/g)?.length).toBe(1);
  // balanced quotes in every attribute
  for (const tag of svg.match(/<[^>]+>/g) ?? []) expect((tag.match(/"/g)?.length ?? 0) % 2).toBe(0);
}

describe('F14 embed SVG — XSS fuzz', () => {
  it('escapes known payloads in every text field', () => {
    for (const p of PAYLOADS) {
      assertSafe(renderEmbed({ ...base, name: p, login: p, galaxy: p, subclass: p, state: p }));
      assertSafe(renderEmbed({ ...base, planets: [{ color: p, orbit: 5, period: 5, size: 1 }] }, 'light', 'sm'));
    }
  });
  it('random fuzz (2,000 cases)', { timeout: 30_000 }, () => {
    const rng = mulberry32(1337);
    const alphabet = '<>"\'&/=:;()[]{}!-_ aZ09‮​\u0000\n\tscriptonloadhrefjavascript';
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: 1 + Math.floor(rng() * 60) }, () => alphabet[Math.floor(rng() * alphabet.length)]).join('');
      assertSafe(renderEmbed({ ...base, name: s, login: s, galaxy: s, temperature: rng() * 1e5, radius: rng() * 1e3 - 10 }));
    }
  });
  it('non-finite numbers do not break the document', () => {
    const svg = renderEmbed({ ...base, temperature: Number.NaN, radius: Number.POSITIVE_INFINITY, cTotal: Number.NaN });
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
  it('xmlEscape', () => expect(xmlEscape(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;'));
});
