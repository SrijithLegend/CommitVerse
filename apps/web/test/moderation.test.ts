import { expect, it } from 'vitest';
import { cleanUserText, containsProfanity, normalizeText } from '../lib/server/moderation';

it('moderation', () => {
  expect(normalizeText('a​b‮c  d')).toBe('abc d');
  expect(containsProfanity('grape spice Scunthorpe brandi')).toBe(false);
  expect(containsProfanity('f.u.c.k you')).toBe(true);
  expect(containsProfanity('you n1gg3r')).toBe(true);
  expect(containsProfanity('what a sh1t')).toBe(true);
  expect(cleanUserText('ｈｅｌｌｏ　world', 5).text).toBe('hello');
});
