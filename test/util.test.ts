import { describe, expect, it } from 'vitest';
import { hueFamily, isStockGradient, parseColor } from '../src/util/color.js';
import { findClaims, findPlaceholders, findStockPhrases, hasEmoji } from '../src/util/text.js';
import { isAllowed, parseRobots } from '../src/render/robots.js';

describe('color', () => {
  it('parses rgb, hex, and oklch', () => {
    expect(parseColor('rgb(168, 85, 247)')).toMatchObject({ r: 168, g: 85, b: 247, a: 1 });
    expect(parseColor('#a855f7')).toMatchObject({ r: 168, g: 85, b: 247 });
    expect(parseColor('#fff')).toMatchObject({ r: 255, g: 255, b: 255 });
    const ok = parseColor('oklch(0.627 0.265 303.9)')!; // Tailwind v4 purple-500
    expect(hueFamily(ok)).toBe('violet');
  });

  it('flags the indigo-purple-pink gradient', () => {
    expect(isStockGradient('linear-gradient(135deg, rgb(99, 102, 241) 0%, rgb(168, 85, 247) 50%, rgb(236, 72, 153) 100%)')).toBe(true);
    expect(isStockGradient('linear-gradient(to right in oklab, oklch(0.585 0.233 277.117) 0%, oklch(0.656 0.241 354.308) 100%)')).toBe(true);
  });

  it('does not flag tonal, warm, or neutral gradients', () => {
    expect(isStockGradient('linear-gradient(rgb(99, 102, 241), rgb(67, 56, 202))')).toBe(false); // indigo ramp
    expect(isStockGradient('linear-gradient(90deg, #f97316, #facc15)')).toBe(false); // orange-yellow
    expect(isStockGradient('linear-gradient(#ffffff, #f3f4f6)')).toBe(false);
    expect(isStockGradient('linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.6))')).toBe(false);
  });
});

describe('text patterns', () => {
  it('finds stock phrases', () => {
    const m = findStockPhrases('Unlock the power of seamless collaboration').map((x) => x.phrase);
    expect(m).toContain('unlock the power/potential');
    expect(m).toContain('seamless');
    expect(findStockPhrases('Bookkeeping for bakeries that close at 3pm')).toHaveLength(0);
  });

  it('finds placeholders and claims', () => {
    expect(findPlaceholders('Lorem ipsum dolor sit amet').length).toBe(1);
    expect(findPlaceholders('Contact jane.doe@example.com').map((x) => x.phrase)).toContain('example domain');
    expect(findPlaceholders('Ledgerline Ltd, registered in England')).toHaveLength(0);
    expect(findClaims('Trusted by 10,000+ teams worldwide').length).toBeGreaterThan(0);
    expect(findClaims('99.9% uptime guaranteed').length).toBe(1);
  });

  it('detects emoji but not punctuation', () => {
    expect(hasEmoji('🚀 Fast')).toBe(true);
    expect(hasEmoji('Fast — and £24 a month')).toBe(false);
  });
});

describe('robots.txt', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/public\n\nUser-agent: other\nDisallow: /');
  it('applies longest match with allow winning ties', () => {
    expect(isAllowed(rules, '/')).toBe(true);
    expect(isAllowed(rules, '/admin/users')).toBe(false);
    expect(isAllowed(rules, '/admin/public/page')).toBe(true);
  });
});
