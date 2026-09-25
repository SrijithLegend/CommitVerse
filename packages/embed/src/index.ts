/**
 * F14 — README embed: an animated SVG card (CSS keyframes only — GitHub strips scripts).
 * Every user-controlled string is XML-escaped; colours are validated hex. This is an XSS surface.
 */
import { kelvinToHex } from '@commitverse/universe-core';

export interface EmbedInput {
  login: string;
  name: string | null;
  temperature: number;
  spectralClass: string;
  subclass: string;
  state: string;
  radius: number;
  cTotal: number;
  c30: number;
  starsTotal: number;
  galaxy: string;
  planets: { color: string; orbit: number; period: number; size: number }[];
  pulsar: boolean;
}

export type EmbedTheme = 'dark' | 'light';
export type EmbedSize = 'sm' | 'md';

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Escapes XML specials and drops characters that are invalid in XML 1.0 or can reorder text (bidi overrides). */
export function xmlEscape(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, '')
      .replace(/[‪-‮⁦-⁩​-‏﻿]/g, '')
      .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!)
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const safeColor = (c: string, fallback = '#8b93a7') => (HEX.test(c) ? c : fallback);
const num = (n: number) => (Number.isFinite(n) ? n : 0);
const COMPACT = Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const compact = (n: number) => COMPACT.format(Math.max(0, Math.round(num(n))));

export function renderEmbed(input: EmbedInput, theme: EmbedTheme = 'dark', size: EmbedSize = 'md'): string {
  const W = size === 'sm' ? 360 : 480;
  const H = size === 'sm' ? 140 : 180;
  const cx = H / 2 + 10;
  const cy = H / 2;
  const bg = theme === 'dark' ? '#070a14' : '#f6f8fc';
  const ink1 = theme === 'dark' ? '#e8ecf6' : '#0b1020';
  const ink2 = theme === 'dark' ? '#9aa4bd' : '#4a5470';
  const line = theme === 'dark' ? 'rgba(160,190,255,0.12)' : 'rgba(20,40,90,0.12)';
  const starColor = safeColor(kelvinToHex(num(input.temperature)), '#ffd08a');
  const starR = Math.max(6, Math.min(22, 4 + num(input.radius) * 3));
  const maxOrbit = H / 2 - 12;
  const planets = input.planets.slice(0, 8);
  const lastOrbit = Math.max(1, ...planets.map((p) => num(p.orbit)));

  const orbits = planets
    .map((p, i) => {
      const r = Math.max(starR + 8, (num(p.orbit) / lastOrbit) * maxOrbit);
      const dur = Math.max(4, Math.min(60, num(p.period))).toFixed(2);
      const pr = Math.max(1.5, Math.min(4.5, 1.5 + num(p.size) * 4)).toFixed(2);
      return `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="none" stroke="${line}" stroke-width="1"/>
<g class="o" style="animation-duration:${dur}s;animation-delay:-${((i * 7.3) % 10).toFixed(2)}s"><circle cx="${(cx + r).toFixed(2)}" cy="${cy}" r="${pr}" fill="${safeColor(p.color)}"/></g>`;
    })
    .join('\n');

  const name = xmlEscape((input.name || input.login).slice(0, 40));
  const login = xmlEscape(input.login.slice(0, 39));
  const galaxy = xmlEscape(input.galaxy.slice(0, 32));
  const cls = xmlEscape(input.subclass.slice(0, 3));
  const state = xmlEscape(input.state.replace('_', ' ').slice(0, 16));
  const tx = H + 16;
  const fs = size === 'sm' ? 0.85 : 1;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${login}'s star system on Commitverse">
<title>@${login} · ${cls} ${state} star · Commitverse</title>
<style>
.o{transform-origin:${cx}px ${cy}px;animation:spin linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.g{animation:glow 4s ease-in-out infinite}
@keyframes glow{50%{opacity:.75}}
${input.pulsar ? `.p{transform-origin:${cx}px ${cy}px;animation:spin 1.6s linear infinite}` : ''}
@media (prefers-reduced-motion:reduce){.o,.g,.p{animation:none}}
text{font-family:ui-monospace,'JetBrains Mono',SFMono-Regular,Menlo,monospace}
</style>
<defs><radialGradient id="h"><stop offset="0" stop-color="${starColor}" stop-opacity=".9"/><stop offset=".35" stop-color="${starColor}" stop-opacity=".25"/><stop offset="1" stop-color="${starColor}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" rx="10" fill="${bg}"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="${line}"/>
${orbits}
<circle class="g" cx="${cx}" cy="${cy}" r="${(starR * 2.6).toFixed(2)}" fill="url(#h)"/>
${input.pulsar ? `<g class="p"><path d="M${cx} ${cy - starR * 3.2}L${cx - 2} ${cy}L${cx} ${cy + starR * 3.2}L${cx + 2} ${cy}Z" fill="${starColor}" opacity=".5"/></g>` : ''}
<circle cx="${cx}" cy="${cy}" r="${starR.toFixed(2)}" fill="${starColor}"/>
<text x="${tx}" y="${32 * fs}" fill="${ink1}" font-size="${16 * fs}" font-weight="600">${name}</text>
<text x="${tx}" y="${50 * fs}" fill="${ink2}" font-size="${11 * fs}">@${login} · ${galaxy}</text>
<text x="${tx}" y="${76 * fs}" fill="${starColor}" font-size="${13 * fs}" font-weight="600">${cls} · ${state}</text>
<text x="${tx}" y="${104 * fs}" fill="${ink2}" font-size="${10 * fs}">CONTRIB</text><text x="${tx}" y="${120 * fs}" fill="${ink1}" font-size="${14 * fs}">${compact(input.cTotal)}</text>
<text x="${tx + 76 * fs}" y="${104 * fs}" fill="${ink2}" font-size="${10 * fs}">30 DAYS</text><text x="${tx + 76 * fs}" y="${120 * fs}" fill="${ink1}" font-size="${14 * fs}">${compact(input.c30)}</text>
<text x="${tx + 152 * fs}" y="${104 * fs}" fill="${ink2}" font-size="${10 * fs}">STARS</text><text x="${tx + 152 * fs}" y="${120 * fs}" fill="${ink1}" font-size="${14 * fs}">${compact(input.starsTotal)}</text>
<text x="${W - 12}" y="${H - 10}" fill="${ink2}" font-size="${9 * fs}" text-anchor="end" opacity=".7">commitverse</text>
</svg>`;
}
