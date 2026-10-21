import type { Evidence } from '../types.js';
import { truncate } from '../util/text.js';
import { el, pagesWith, plural, uniqueRoutes } from './helpers.js';
import { isLocalCrawl } from './performance.js';
import type { FindingInput, Rule } from './types.js';

const m = (route: string, detail: string): Evidence => ({ type: 'metric', route, detail });

export const titles: Rule = {
  id: 'seo-title',
  title: 'Page titles missing, duplicated, or the wrong length',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  description: 'Every page needs a unique <title> of about 10 to 60 characters.',
  run({ crawl }) {
    const out: FindingInput[] = [];
    const missing: Evidence[] = [];
    const length: Evidence[] = [];
    const byTitle = new Map<string, string[]>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const t = facts.title.trim();
      if (!t) missing.push(m(page.path, 'no <title>'));
      else {
        if (t.length < 10 || t.length > 60) length.push(m(page.path, `"${truncate(t, 80)}" is ${t.length} characters`));
        byTitle.set(t, [...(byTitle.get(t) ?? []), page.path]);
      }
    }
    if (missing.length)
      out.push({ title: 'Pages without a title', severity: 'high', confidence: 0.95, description: `${plural(missing.length, 'page')} have no <title>. Search results and browser tabs show the URL instead.`, recommendation: 'Give every page a <title> that names the page first and the site second, for example "Pricing · NovaFlow".', evidence: missing, routes: uniqueRoutes(missing) });
    const dupes = [...byTitle].filter(([, ps]) => ps.length > 1);
    if (dupes.length) {
      const ev = dupes.flatMap(([t, ps]) => ps.map((p) => m(p, `shares the title "${truncate(t, 70)}" with ${ps.length - 1} other page${ps.length > 2 ? 's' : ''}`)));
      out.push({ title: 'Duplicate page titles', severity: 'medium', confidence: 0.95, description: `${plural(dupes.reduce((s, [, ps]) => s + ps.length, 0), 'page')} share a title with another page, so search engines cannot tell them apart.`, recommendation: 'Write a distinct title per page that says what that page is about.', evidence: ev, routes: uniqueRoutes(ev) });
    }
    if (length.length)
      out.push({ title: 'Titles too short or too long', severity: 'low', confidence: 0.8, description: `${plural(length.length, 'title')} fall outside 10 to 60 characters; long ones are cut off in search results.`, recommendation: 'Keep titles between roughly 10 and 60 characters, with the important words first.', evidence: length, routes: uniqueRoutes(length) });
    return out;
  },
};

export const descriptions: Rule = {
  id: 'seo-description',
  title: 'Meta descriptions missing or duplicated',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  description: 'Each page should have its own meta description of about 50 to 160 characters.',
  run({ crawl }) {
    const out: FindingInput[] = [];
    const missing: Evidence[] = [];
    const length: Evidence[] = [];
    const byDesc = new Map<string, string[]>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const d = (facts.metaDescription ?? '').trim();
      if (!d) missing.push(m(page.path, 'no meta description'));
      else {
        if (d.length < 50 || d.length > 160) length.push(m(page.path, `${d.length} characters: "${truncate(d, 90)}"`));
        byDesc.set(d, [...(byDesc.get(d) ?? []), page.path]);
      }
    }
    if (missing.length)
      out.push({ title: 'Pages without a meta description', severity: 'medium', confidence: 0.95, description: `${plural(missing.length, 'page')} have no meta description, so search engines pick a random snippet from the page.`, recommendation: 'Add <meta name="description"> with one or two sentences saying what the page offers and for whom.', evidence: missing, routes: uniqueRoutes(missing) });
    const dupes = [...byDesc].filter(([, ps]) => ps.length > 1);
    if (dupes.length) {
      const ev = dupes.flatMap(([, ps]) => ps.map((p) => m(p, `same description as ${ps.length - 1} other page${ps.length > 2 ? 's' : ''}`)));
      out.push({ title: 'Duplicate meta descriptions', severity: 'low', confidence: 0.95, description: `${plural(ev.length, 'page')} reuse another page's description.`, recommendation: 'Write a description specific to each page.', evidence: ev, routes: uniqueRoutes(ev) });
    }
    if (length.length)
      out.push({ title: 'Descriptions too short or too long', severity: 'low', confidence: 0.75, description: `${plural(length.length, 'description')} fall outside about 50 to 160 characters.`, recommendation: 'Aim for 50 to 160 characters so the full description shows in results.', evidence: length, routes: uniqueRoutes(length) });
    return out;
  },
};

export const noindex: Rule = {
  id: 'seo-noindex',
  title: 'Pages hidden from search engines',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  description: 'Pages with a noindex robots meta tag or X-Robots-Tag header.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const metaRobots = facts.seo?.robots ?? '';
      const header = page.headers?.['x-robots-tag'] ?? '';
      if (/noindex/i.test(metaRobots)) ev.push(m(page.path, `<meta name="robots" content="${truncate(metaRobots, 60)}">`));
      else if (/noindex/i.test(header)) ev.push(m(page.path, `X-Robots-Tag: ${truncate(header, 60)}`));
    }
    if (!ev.length) return [];
    return [
      {
        severity: isLocalCrawl(crawl) ? 'low' : 'high',
        confidence: 0.95,
        description: `${plural(ev.length, 'page')} tell search engines not to index them. That is right for staging, private pages, and previews, and a serious mistake on a live public page.`,
        recommendation: 'If these pages should appear in search, remove noindex from the robots meta tag or X-Robots-Tag header (often left over from a staging config).',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const canonical: Rule = {
  id: 'seo-canonical',
  title: 'Canonical URL problems',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  penalty: 25,
  description: 'Missing, multiple, or cross-site canonical links.',
  run({ crawl }) {
    const out: FindingInput[] = [];
    const missing: Evidence[] = [];
    const multiple: Evidence[] = [];
    const offsite: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const c = facts.seo?.canonical ?? [];
      if (!facts.seo) continue;
      if (c.length === 0) missing.push(m(page.path, 'no <link rel="canonical">'));
      if (c.length > 1) multiple.push(m(page.path, `${c.length} canonical links: ${c.map((u) => truncate(u, 60)).join(', ')}`));
      // On a local server the canonical rightly names the production domain, so only judge deployed sites.
      if (c.length === 1) {
        try {
          if (!isLocalCrawl(crawl) && new URL(c[0]).hostname !== new URL(page.url).hostname) offsite.push(m(page.path, `canonical points to ${truncate(c[0], 80)}`));
        } catch {
          multiple.push(m(page.path, `invalid canonical URL "${truncate(c[0], 60)}"`));
        }
      }
    }
    if (multiple.length) out.push({ title: 'Conflicting canonical links', severity: 'medium', confidence: 0.95, description: `${plural(multiple.length, 'page')} declare more than one or an invalid canonical URL, so search engines ignore them.`, recommendation: 'Keep exactly one absolute <link rel="canonical"> per page.', evidence: multiple, routes: uniqueRoutes(multiple) });
    if (offsite.length) out.push({ title: 'Canonical points to another domain', severity: 'medium', confidence: 0.7, description: `${plural(offsite.length, 'page')} name a page on another domain as canonical, which hands their search ranking to that domain. Often a template copied from another site, or a staging domain left in.`, recommendation: 'Point canonical links at this site\'s own production URLs unless the content really lives elsewhere.', evidence: offsite, routes: uniqueRoutes(offsite) });
    if (missing.length && !isLocalCrawl(crawl)) out.push({ title: 'No canonical URLs', severity: 'low', confidence: 0.8, description: `${plural(missing.length, 'page')} have no canonical link, so URL variants (with tracking parameters, trailing slashes, or www) can be indexed as separate pages.`, recommendation: 'Add <link rel="canonical" href="https://your-domain/path"> to every page, usually from the layout template.', evidence: missing, routes: uniqueRoutes(missing) });
    return out;
  },
};

export const social: Rule = {
  id: 'seo-social',
  title: 'No link preview for social and chat apps',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  penalty: 25,
  description: 'Pages without Open Graph title and image, so shared links show no preview.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const s = facts.seo;
      if (!s) continue;
      const lacking = [!s.og.title && 'og:title', !s.og.image && 'og:image', !s.twitterCard && 'twitter:card'].filter(Boolean);
      if (!s.og.title || !s.og.image) ev.push(m(page.path, `missing ${lacking.join(', ')}`));
    }
    if (!ev.length) return [];
    return [
      {
        severity: 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'page')} have no Open Graph image or title. Links shared on Slack, LinkedIn, X, or WhatsApp show a bare URL instead of a preview card.`,
        recommendation: 'Add og:title, og:description, og:image (1200x630), and twitter:card="summary_large_image" in the page head.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const structuredData: Rule = {
  id: 'seo-structured-data',
  title: 'Invalid structured data',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  description: 'JSON-LD blocks that are not valid JSON, so search engines ignore them.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) for (const j of facts.seo?.jsonLd ?? []) if (!j.valid) ev.push(m(page.path, `JSON-LD parse error: ${j.error}`));
    if (!ev.length) return [];
    return [{ severity: 'medium', confidence: 0.95, description: `${plural(ev.length, 'structured data block')} fail to parse, so rich results (ratings, prices, FAQ) are lost.`, recommendation: 'Fix the JSON syntax and check the block with Google\'s Rich Results Test.', evidence: ev, routes: uniqueRoutes(ev) }];
  },
};

export const viewportMeta: Rule = {
  id: 'seo-viewport',
  title: 'No mobile viewport tag',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  description: 'Pages without <meta name="viewport">, which phones render as a zoomed-out desktop page.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) if (facts.seo && !facts.seo.viewport) ev.push(m(page.path, 'no <meta name="viewport">'));
    if (!ev.length) return [];
    return [{ severity: 'high', confidence: 0.95, description: `${plural(ev.length, 'page')} have no viewport meta tag. Phones show them as a tiny desktop page, and Google ranks them as not mobile-friendly.`, recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the page head.', evidence: ev, routes: uniqueRoutes(ev) }];
  },
};

export const crawlability: Rule = {
  id: 'seo-crawlable-links',
  title: 'Links search engines cannot follow',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  penalty: 25,
  description: '<a> elements without an href, usually navigation handled only by JavaScript click handlers.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) for (const l of facts.seo?.uncrawlableLinks ?? []) ev.push(el(page, 'desktop', l, l.text, '<a> without href'));
    if (!ev.length) return [];
    return [{ severity: 'low', confidence: 0.85, description: `${plural(ev.length, 'link')} have no href. Search engines cannot follow them, and they cannot be opened in a new tab.`, recommendation: 'Give navigation links a real href, or use a <button> when the element performs an action instead of navigating.', evidence: ev, routes: uniqueRoutes(ev) }];
  },
};

export const robotsAndSitemap: Rule = {
  id: 'seo-robots-sitemap',
  title: 'robots.txt and sitemap problems',
  category: 'seo',
  needs: 'rendered',
  verified: true,
  description: 'robots.txt blocking the whole site, or a missing robots.txt or sitemap.xml. Deployed sites only.',
  run({ crawl }) {
    const site = crawl?.site;
    if (!site || isLocalCrawl(crawl)) return [];
    const out: FindingInput[] = [];
    const where = new URL(crawl.baseUrl).origin;
    if (site.robotsTxt.disallowAll)
      out.push({ title: 'robots.txt blocks the whole site', severity: 'high', confidence: 0.95, description: 'robots.txt disallows "/" for all crawlers, so search engines will not crawl any page.', recommendation: 'Remove "Disallow: /" from robots.txt unless the site is meant to stay out of search (often left over from staging).', evidence: [{ type: 'network', excerpt: `${where}/robots.txt`, detail: 'Disallow: / for User-agent: *' }] });
    const missing = [site.robotsTxt.status === 404 && 'robots.txt', site.sitemap.status === 404 && 'sitemap.xml'].filter(Boolean) as string[];
    if (missing.length)
      out.push({ title: `No ${missing.join(' or ')}`, severity: 'low', confidence: 0.85, description: `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing at the site root. Search engines find pages more slowly without a sitemap.`, recommendation: 'Publish /sitemap.xml listing your public pages and a /robots.txt that points to it with a Sitemap: line. Most frameworks have a plugin for both.', evidence: missing.map((f) => ({ type: 'network' as const, excerpt: `${where}/${f}`, detail: 'HTTP 404' })) });
    return out;
  },
};

export const seoRules: Rule[] = [titles, descriptions, noindex, canonical, social, structuredData, viewportMeta, crawlability, robotsAndSitemap];
