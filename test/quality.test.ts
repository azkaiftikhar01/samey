import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/index.js';
import type { AxeViolation, PerfFacts, ResourceFact, SeoFacts } from '../src/types.js';
import { crawlOf, page, viewport } from './helpers.js';

const r = { x: 0, y: 0, width: 400, height: 300 };
const ids = (c: ReturnType<typeof crawlOf>) => runRules({ crawl: c }).findings.map((f) => f.ruleId);
const find = (c: ReturnType<typeof crawlOf>, id: string) => runRules({ crawl: c }).findings.find((f) => f.ruleId === id);
const REMOTE = { baseUrl: 'https://example.com/' };
const perf = (over: Partial<PerfFacts> = {}): PerfFacts => ({ domNodes: 400, domDepth: 12, cls: 0, clsSources: [], blockingMs: 0, longTasks: 0, images: [], renderBlocking: [], ...over });
const seo = (over: Partial<SeoFacts> = {}): SeoFacts => ({ canonical: ['https://example.com/'], robots: null, viewport: 'width=device-width', og: { title: 't', image: 'i.png' }, twitterCard: 'summary', jsonLd: [], uncrawlableLinks: [], ...over });
const res = (over: Partial<ResourceFact>): ResourceFact => ({ url: 'https://example.com/a.js', type: 'script', bytes: 1000, status: 200, sameOrigin: true, contentType: 'text/javascript', encoding: 'br', cacheControl: 'max-age=31536000', ...over });
const MB = 1024 * 1024;

describe('axe-core findings', () => {
  const violation = (over: Partial<AxeViolation>): AxeViolation => ({
    id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', description: 'Ensures contrast', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast', tags: ['wcag2aa', 'wcag143'], nodeCount: 2,
    nodes: [{ target: '.hero p', html: '<p class="faint">x</p>', summary: 'Fix any of the following:\n  Element has insufficient color contrast of 2.1', rect: r }], ...over,
  });

  it('turns each axe check into one finding with WCAG reference and evidence', () => {
    const f = find(crawlOf([page('/', { axe: [violation({})] }), page('/about', { axe: [violation({})] })]), 'axe/color-contrast')!;
    expect(f.severity).toBe('medium');
    expect(f.verified).toBe(true);
    expect(f.description).toContain('WCAG 1.4.3');
    expect(f.evidence[0]).toMatchObject({ selector: '.hero p', excerpt: '<p class="faint">x</p>', detail: 'Element has insufficient color contrast of 2.1' });
    expect(f.evidence[0].alsoOn).toEqual(['/about']);
  });

  it('weighs best-practice rules a step below WCAG failures', () => {
    const f = find(crawlOf([page('/', { axe: [violation({ id: 'region', impact: 'moderate', tags: ['best-practice'] })] })]), 'axe/region')!;
    expect(f.severity).toBe('low');
  });

  it('stands the hand-written equivalents down when axe ran, and keeps them as a fallback', () => {
    const missingAlt = { images: [{ selector: 'img', rect: r, src: '/x.png', alt: null, broken: false, decorative: false }] };
    expect(ids(crawlOf([page('/', { ...missingAlt, axe: [] })]))).not.toContain('missing-alt');
    expect(ids(crawlOf([page('/', missingAlt)]))).toContain('missing-alt');
  });
});

describe('performance', () => {
  it('flags heavy pages and too much JavaScript', () => {
    const resources = [res({ bytes: 2.5 * MB }), res({ url: 'https://example.com/hero.jpg', type: 'image', bytes: 4 * MB })];
    const c = crawlOf([page('/', {}, { resources })], REMOTE);
    expect(find(c, 'perf-page-weight')!.severity).toBe('high');
    expect(find(c, 'perf-javascript')!.severity).toBe('high');
    expect(ids(crawlOf([page('/', {}, { resources: [res({ bytes: 200_000 })] })], REMOTE))).not.toContain('perf-page-weight');
  });

  it('flags images served far larger than displayed, but not 2x retina images', () => {
    const img = (naturalW: number) => ({ selector: 'img', rect: { ...r, width: 400 }, src: 'https://example.com/p.webp', naturalW, naturalH: naturalW, lazy: false, hasDims: true, belowFold: false });
    const resources = [res({ url: 'https://example.com/p.webp', type: 'image', contentType: 'image/webp', bytes: 600_000 })];
    expect(ids(crawlOf([page('/', { perf: perf({ images: [img(2400)] }) }, { resources })], REMOTE))).toContain('perf-images');
    expect(ids(crawlOf([page('/', { perf: perf({ images: [img(800)] }) }, { resources })], REMOTE))).not.toContain('perf-images');
  });

  it('flags a lazy-loaded main image, layout shift, and long main-thread blocking', () => {
    const c = crawlOf([page('/', { perf: perf({ lcp: { selector: 'img.hero', rect: r, tag: 'img', src: '/hero.jpg', lazy: true }, cls: 0.31, blockingMs: 720, longTasks: 4 }) })]);
    expect(find(c, 'perf-lcp-lazy')).toBeDefined();
    expect(find(c, 'perf-layout-shift')!.severity).toBe('high');
    expect(find(c, 'perf-main-thread')!.severity).toBe('high');
    expect(ids(crawlOf([page('/', { perf: perf({ cls: 0.05, blockingMs: 120 }) })]))).not.toEqual(expect.arrayContaining(['perf-layout-shift', 'perf-main-thread']));
  });

  it('counts one shared render-blocking script once across pages', () => {
    const rb = { renderBlocking: [{ url: 'https://example.com/legacy.js', kind: 'script' as const }] };
    const f = find(crawlOf([page('/', { perf: perf(rb) }), page('/about', { perf: perf(rb) })]), 'perf-render-blocking')!;
    expect(f.description).toMatch(/^1 resource block/);
  });

  it('checks compression and caching only on deployed sites', () => {
    const resources = [res({ encoding: undefined, bytes: 50_000 }), ...['a', 'b', 'c'].map((n) => res({ url: `https://example.com/${n}.css`, type: 'stylesheet', cacheControl: 'max-age=60' }))];
    const remote = ids(crawlOf([page('/', {}, { resources })], REMOTE));
    expect(remote).toEqual(expect.arrayContaining(['perf-compression', 'perf-caching']));
    const local = ids(crawlOf([page('/', {}, { resources })]));
    expect(local).not.toContain('perf-compression');
    expect(local).not.toContain('perf-caching');
  });
});

describe('SEO', () => {
  it('finds missing, duplicate, and badly sized titles and descriptions', () => {
    const c = crawlOf([page('/', { title: 'Home', metaDescription: null }), page('/a', { title: 'Home', metaDescription: null })]);
    const out = runRules({ crawl: c }).findings;
    expect(out.map((f) => f.title)).toEqual(expect.arrayContaining(['Duplicate page titles', 'Titles too short or too long', 'Pages without a meta description']));
  });

  it('flags noindex, conflicting canonicals, a missing viewport, invalid JSON-LD, and links without href', () => {
    const c = crawlOf(
      [
        page('/', { seo: seo({ robots: 'noindex, nofollow', canonical: ['https://example.com/', 'https://example.com/home'], viewport: null, jsonLd: [{ valid: false, types: [], error: 'Unexpected token' }], uncrawlableLinks: [{ selector: 'a', rect: r, text: 'Shop' }] }) }),
      ],
      REMOTE,
    );
    const got = ids(c);
    expect(got).toEqual(expect.arrayContaining(['seo-noindex', 'seo-canonical', 'seo-viewport', 'seo-structured-data', 'seo-crawlable-links']));
    expect(find(c, 'seo-noindex')!.severity).toBe('high');
  });

  it('treats noindex on a local server as low severity', () => {
    expect(find(crawlOf([page('/', { seo: seo({ robots: 'noindex' }) })]), 'seo-noindex')!.severity).toBe('low');
  });

  it('flags robots.txt that blocks everything, only on deployed sites', () => {
    const site = { robotsTxt: { status: 200, disallowAll: true }, sitemap: { status: 404, urls: 0 } };
    const remote = runRules({ crawl: crawlOf([page('/')], { ...REMOTE, site }) }).findings.filter((f) => f.ruleId === 'seo-robots-sitemap');
    expect(remote.map((f) => f.title)).toEqual(['robots.txt blocks the whole site', 'No sitemap.xml']);
    expect(ids(crawlOf([page('/')], { site }))).not.toContain('seo-robots-sitemap');
  });

  it('does not flag a well-formed page', () => {
    const c = crawlOf([page('/', { title: 'Pricing for small teams · Ledgerline', metaDescription: 'Ledgerline pricing for bakeries: one shop is £24 a month, two to five shops are £19 each.', seo: seo() }, { url: 'https://example.com/' })], REMOTE);
    expect(ids(c).filter((id) => id.startsWith('seo-') && id !== 'seo-robots-sitemap')).toEqual([]);
  });
});

describe('best practices', () => {
  it('flags plain HTTP on deployed sites and mixed content', () => {
    const http = crawlOf([page('/', {}, { url: 'http://example.com/' })], { baseUrl: 'http://example.com/' });
    expect(ids(http)).toContain('bp-https');
    const mixed = crawlOf([page('/', {}, { url: 'https://example.com/', resources: [res({ url: 'http://cdn.example.com/x.js' })] })], REMOTE);
    expect(find(mixed, 'bp-https')!.title).toBe('Mixed content');
  });

  it('flags quirks mode, distorted images, and outdated libraries, with version-aware checks', () => {
    const practices = (libs: { name: string; version: string }[]) => ({ compatMode: 'BackCompat', charsetMeta: true, distortedImages: [{ selector: 'img', rect: r, src: '/a.jpg', natural: '800x400', rendered: '400x400' }], libraries: libs, favicon: true });
    const c = crawlOf([page('/', { practices: practices([{ name: 'jQuery', version: '1.12.4' }]) })]);
    expect(ids(c)).toEqual(expect.arrayContaining(['bp-doctype', 'bp-image-aspect', 'bp-libraries']));
    expect(find(c, 'bp-libraries')!.description).toContain('jQuery@1.12.4');
    expect(ids(crawlOf([page('/', { practices: { ...practices([{ name: 'jQuery', version: '3.7.1' }]), compatMode: 'CSS1Compat', distortedImages: [] } })]))).not.toContain('bp-libraries');
  });
});

it('keeps the clean viewport helper free of new findings', () => {
  expect(ids(crawlOf([page('/', { perf: perf(), seo: seo(), title: 'A reasonable page title', metaDescription: 'x'.repeat(80) })]))).toEqual([]);
  expect(viewport().rootFontSize).toBe(16);
});
