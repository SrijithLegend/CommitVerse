/**
 * §11.5 text hygiene for bios, banners and signal messages: NFKC, strip zero-width / bidi overrides / controls,
 * collapse whitespace, and a small multilingual profanity + slur filter (with leetspeak folding).
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]|͏|[︀-️]/gu;

export function normalizeText(s: string): string {
  return s.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

// Deliberately short: blocks the most common abuse. Anything subtler goes through reports + (for banners) pre-moderation.
const BLOCKED = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'whore',
  'slut',
  'rape',
  'nazi',
  'kike',
  'spic',
  'chink',
  'tranny',
  'dyke',
  'hitler',
  'kys',
  'killyourself',
  'puta',
  'mierda',
  'pendejo',
  'cabron',
  'merde',
  'connard',
  'salope',
  'scheisse',
  'arschloch',
  'fotze',
  'hurensohn',
  'cazzo',
  'stronzo',
  'vaffanculo',
  'caralho',
  'porra',
  'chutiya',
  'madarchod',
  'bhenchod',
  'behenchod',
  'gandu',
  'randi',
  'bsdk',
  'blyat',
  'suka',
  'pizdec',
  'kurwa',
  'sikerim',
  'orospu',
];

/** Unambiguous tokens that are also caught when glued inside other text ("f.u.c.k", "xxfuckxx"). */
const SQUASH_SAFE = ['fuck', 'nigger', 'nigga', 'faggot', 'killyourself', 'madarchod', 'bhenchod', 'behenchod', 'hurensohn', 'vaffanculo'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'l' };

export function containsProfanity(s: string): boolean {
  const folded = normalizeText(s)
    .toLowerCase()
    .replace(/[0-9@$!|]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1');
  const squashed = folded.replace(/[^\p{L}]/gu, '');
  return (
    SQUASH_SAFE.some((w) => squashed.includes(w)) ||
    BLOCKED.some((w) => new RegExp(`(^|[^\\p{L}])${w}(s|es|ed|ing|er)?($|[^\\p{L}])`, 'u').test(folded))
  );
}

export interface CleanResult {
  text: string;
  flagged: boolean;
}

export function cleanUserText(s: string, max: number): CleanResult {
  const text = normalizeText(s).slice(0, max);
  return { text, flagged: containsProfanity(text) };
}
