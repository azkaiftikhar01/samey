import type { Evidence } from '../types.js';
import { ATTRIBUTION, findClaims, findPlaceholders, findStockPhrases, GENERIC_LINK_TEXT, snippetAround, truncate } from '../util/text.js';
import { el, inChrome, pagesWith, plural, uniqueRoutes } from './helpers.js';
import type { Rule } from './types.js';

const PLACEHOLDER_IMG = /(?:via\.placeholder\.com|placehold\.(?:co|it)|placekitten|picsum\.photos|dummyimage\.com|fakeimg\.pl|source\.unsplash\.com\/random|placeholder\.(?:png|jpe?g|svg|webp))/i;

export const stockCopy: Rule = {
  id: 'stock-copy',
  title: 'Interchangeable marketing copy',
  category: 'content',
  needs: 'rendered',
  verified: false,
  description: 'Headlines and body text built from stock phrases that could describe any product.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    const seen = new Set<string>();
    let inHeadings = 0;
    let inH1 = false;
    const phrases = new Map<string, number>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const b of facts.textBlocks) {
        if (!/^(?:h[1-6]|p|li|button|a|dd|figcaption|blockquote|span|div)$/.test(b.tag)) continue;
        if (seen.has(b.text)) continue;
        const matches = findStockPhrases(b.text);
        if (!matches.length) continue;
        seen.add(b.text);
        for (const m of matches) phrases.set(m.phrase, (phrases.get(m.phrase) ?? 0) + 1);
        if (/^h[1-6]$/.test(b.tag)) inHeadings++;
        if (b.tag === 'h1') inH1 = true;
        ev.push(el(page, 'desktop', b, snippetAround(b.text, matches[0].index), matches.map((m) => `"${m.phrase}"`).join(', ')));
      }
    }
    if (ev.length < 2 && !inH1) return [];
    const top = [...phrases].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => `"${p}"`);
    return [
      {
        severity: inH1 || inHeadings >= 3 || ev.length >= 6 ? 'medium' : 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'text block')} lean on stock phrases (${top.join(', ')})${inHeadings ? `, ${inHeadings} of them in headings` : ''}. Copy like this could be pasted onto any product and says nothing about this one.`,
        recommendation:
          'Rewrite headings to state what the product does, for whom, and the concrete result. Replace adjectives with specifics: numbers you can back up, named features, a real example.',
        evidence: ev.sort((a, b) => (b.detail?.length ?? 0) - (a.detail?.length ?? 0)),
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const placeholderContent: Rule = {
  id: 'placeholder-content',
  title: 'Placeholder content shipped',
  category: 'content',
  needs: 'rendered',
  verified: true,
  description: 'Lorem ipsum, sample names and companies, example domains, and placeholder images.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    const seen = new Set<string>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const b of facts.textBlocks) {
        if (seen.has(b.text)) continue;
        const m = findPlaceholders(b.text);
        if (!m.length) continue;
        seen.add(b.text);
        ev.push(el(page, 'desktop', b, snippetAround(b.text, m[0].index), m.map((x) => x.phrase).join(', ')));
      }
      for (const img of facts.images) {
        if (PLACEHOLDER_IMG.test(img.src)) ev.push(el(page, 'desktop', img, truncate(img.src, 100), 'placeholder image service'));
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: ev.length >= 3 ? 'high' : 'medium',
        confidence: 0.9,
        description: `Found ${plural(ev.length, 'piece')} of placeholder content. Visitors notice this immediately and it signals the site is unfinished.`,
        recommendation: 'Replace every placeholder with real content, or remove the section until the content exists.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const duplicateCopy: Rule = {
  id: 'duplicate-copy',
  title: 'Repeated paragraphs',
  category: 'content',
  needs: 'rendered',
  verified: true,
  description: 'The same paragraph text repeated across the site outside header and footer.',
  run({ crawl }) {
    const byText = new Map<string, Evidence[]>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const b of facts.textBlocks) {
        if (b.tag !== 'p' && b.tag !== 'li' && b.tag !== 'dd') continue;
        if (b.text.length < 60 || inChrome(facts, b)) continue;
        if (!byText.has(b.text)) byText.set(b.text, []);
        byText.get(b.text)!.push(el(page, 'desktop', b, truncate(b.text, 100)));
      }
    }
    const dupes = [...byText].filter(([, ev]) => ev.length >= 2);
    if (!dupes.length) return [];
    const ev = dupes.slice(0, 6).flatMap(([, e]) => e.slice(0, 2));
    return [
      {
        severity: dupes.length >= 3 ? 'medium' : 'low',
        confidence: 0.9,
        description: `${plural(dupes.length, 'paragraph')} appear more than once across the site. Repeated copy suggests sections were duplicated rather than written.`,
        recommendation: 'Write copy specific to each place it appears, or remove the duplicate.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const unverifiedClaims: Rule = {
  id: 'unverified-claims',
  title: 'Unsupported credibility claims',
  category: 'content',
  needs: 'rendered',
  verified: false,
  penalty: 20,
  description: 'User counts, ratings, and performance percentages stated without a source.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    const seen = new Set<string>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const b of facts.textBlocks) {
        if (b.text.length > 300 || seen.has(b.text)) continue;
        const m = findClaims(b.text);
        if (!m.length) continue;
        seen.add(b.text);
        ev.push(el(page, 'desktop', b, snippetAround(b.text, m[0].index), m.map((x) => x.phrase).join(', ')));
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: ev.length >= 4 ? 'medium' : 'low',
        confidence: 0.35,
        description: `${plural(ev.length, 'claim')} such as user counts, ratings, or percentages appear without a visible source. If these are real, they are fine; generated sites often invent them.`,
        recommendation: 'Keep only numbers you can substantiate, and link or footnote the source. Remove invented social proof before launch.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const anonymousTestimonials: Rule = {
  id: 'anonymous-testimonials',
  title: 'Testimonials without verifiable attribution',
  category: 'content',
  needs: 'rendered',
  verified: false,
  penalty: 20,
  description: 'Testimonials attributed to a name and title with no photo, link, or company.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const s of facts.sections) {
        if (s.isChrome) continue;
        const isTestimonials = s.hasBlockquote || /testimonial|what (?:our|people|customers)|loved by|customers say/i.test(s.heading ?? '');
        if (!isTestimonials || !ATTRIBUTION.test(s.text)) continue;
        if (s.imageCount > 0) continue;
        ev.push(el(page, 'desktop', s, truncate(s.text.match(ATTRIBUTION)?.[0] ?? s.heading ?? '', 80), 'quote with name and title only'));
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: 'low',
        confidence: 0.35,
        description: `${plural(ev.length, 'testimonial section')} attribute quotes to a name and job title with no photo, company link, or source. Readers increasingly assume these are invented.`,
        recommendation: 'Use real testimonials with permission, a photo or company logo, and a link where possible. If you have none yet, remove the section.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const genericLinkText: Rule = {
  id: 'generic-link-text',
  title: 'Vague link and button labels',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  penalty: 25,
  description: 'Several links labelled "Learn more", "Read more", or "Click here".',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const l of facts.links) if (GENERIC_LINK_TEXT.test(l.text.trim())) ev.push(el(page, 'desktop', l, l.text));
    }
    if (ev.length < 3) return [];
    return [
      {
        severity: 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'link')} use labels like "Learn more" that do not say where they go. Screen reader users navigating by links hear a list of identical labels.`,
        recommendation: 'Name the destination: "Read the pricing FAQ", "See how imports work".',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const contentRules: Rule[] = [stockCopy, placeholderContent, duplicateCopy, unverifiedClaims, anonymousTestimonials, genericLinkText];
