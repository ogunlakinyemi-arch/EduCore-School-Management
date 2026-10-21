import { describe, expect, it } from 'vitest';
import { validTelegramUrl } from './telegram-url';
const tok = 'A'.repeat(43);
describe('validTelegramUrl', () => {
  it('accepts exact bot start link', () => expect(validTelegramUrl(`https://t.me/edu_bot?start=${tok}`)).toBe(`https://t.me/edu_bot?start=${tok}`));
  it('rejects others', () => {
    for (const u of [`http://t.me/edu_bot?start=${tok}`, `https://evil.com/edu_bot?start=${tok}`, `https://t.me/edu_bot?start=${tok}&x=1`, `https://t.me/edu_bot?start=${'A'.repeat(42)}`, `https://t.me/edu_bot?start=${'+'.repeat(43)}`, 'https://t.me/b?start=x', undefined, 5])
      expect(validTelegramUrl(u)).toBeNull();
  });
});
