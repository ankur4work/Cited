import { describe, expect, it } from 'vitest';
import { publicAuthorName } from './author-name';

describe('publicAuthorName', () => {
  it('passes an ordinary name through', () => {
    expect(publicAuthorName('Priya R.')).toBe('Priya R.');
  });

  it('refuses anything carrying an email address', () => {
    // The case this exists for: Shopify's customer displayName falls back to
    // the email when the account has no name, and it was published verbatim
    // on a product page.
    expect(publicAuthorName('cryptokingsss1@gmail.com')).toBeNull();
  });

  it('refuses an address embedded in a longer string', () => {
    expect(publicAuthorName('Sam <sam@example.com>')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(publicAuthorName('  Priya  ')).toBe('Priya');
  });

  it('treats empty, blank and missing alike', () => {
    // Callers choose their own fallback, so all three have to collapse to the
    // same null rather than to '' in some paths and undefined in others.
    expect(publicAuthorName('')).toBeNull();
    expect(publicAuthorName('   ')).toBeNull();
    expect(publicAuthorName(null)).toBeNull();
    expect(publicAuthorName(undefined)).toBeNull();
  });
});
