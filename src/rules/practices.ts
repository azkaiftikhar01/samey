import type { Evidence } from '../types.js';
import { truncate } from '../util/text.js';
import { el, pagesWith, plural, uniqueRoutes } from './helpers.js';
import { isLocalCrawl } from './performance.js';
import type { FindingInput, Rule } from './types.js';

const m = (route: string, detail: string): Evidence => ({ type: 'metric', route, detail });

export const https: Rule = {
  id: 'bp-https',
  title: 'Not served over HTTPS',
  category: 'practices',
  needs: 'rendered',
  verified: true,
  description: 'Deployed pages loaded over plain HTTP, or HTTPS pages that load HTTP resources (mixed content).',
  run({ crawl }) {
    const out: FindingInput[] = [];
    const local = isLocalCrawl(crawl);
    const plain: Evidence[] = [];
    const mixed: Evidence[] = [];
    for (const page of crawl?.pages ?? []) {
      if (!page.desktop) continue;
      if (!local && page.url.startsWith('http:')) plain.push(m(page.path, page.url));
      if (page.url.startsWith('https:')) for (const r of page.resources ?? []) if (r.url.startsWith('http:')) mixed.push({ type: 'network', route: page.path, excerpt: truncate(r.url, 140), detail: `${r.type} over plain HTTP` });
    }
    if (plain.length) out.push({ severity: 'high', confidence: 0.95, description: `${plural(plain.length, 'page')} are served over plain HTTP. Browsers mark them "Not secure", and anything typed into them can be read in transit.`, recommendation: 'Serve the site over HTTPS (free with Let\'s Encrypt or any modern host) and redirect HTTP to HTTPS.', evidence: plain, routes: uniqueRoutes(plain) });
    if (mixed.length) out.push({ title: 'Mixed content', severity: 'medium', confidence: 0.95, description: `${plural(mixed.length, 'resource')} load over HTTP on HTTPS pages. Browsers block or warn about them.`, recommendation: 'Change these URLs to https:// (or protocol-relative paths on the same host).', evidence: mixed, routes: uniqueRoutes(mixed) });
    return out;
  },
};

export const documentMode: Rule = {
  id: 'bp-doctype',
  title: 'Page renders in quirks mode',
  category: 'practices',
  needs: 'rendered',
  verified: true,
  description: 'Pages without <!doctype html>, which browsers render with legacy layout rules, or without a declared character set.',
  run({ crawl }) {
    const out: FindingInput[] = [];
    const quirks: Evidence[] = [];
    const charset: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const p = facts.practices;
      if (!p) continue;
      if (p.compatMode === 'BackCompat') quirks.push(m(page.path, 'document.compatMode is BackCompat'));
      if (!p.charsetMeta && !/charset=/i.test(page.headers?.['content-type'] ?? '')) charset.push(m(page.path, 'no <meta charset> and no charset in Content-Type'));
    }
    if (quirks.length) out.push({ severity: 'medium', confidence: 0.95, description: `${plural(quirks.length, 'page')} render in quirks mode, so layout can differ between browsers in ways that are hard to debug.`, recommendation: 'Make <!doctype html> the very first line of every page.', evidence: quirks, routes: uniqueRoutes(quirks) });
    if (charset.length) out.push({ title: 'No character set declared', severity: 'low', confidence: 0.9, description: `${plural(charset.length, 'page')} do not declare a character set, so some browsers may show garbled text.`, recommendation: 'Add <meta charset="utf-8"> as the first element in <head>.', evidence: charset, routes: uniqueRoutes(charset) });
    return out;
  },
};

export const distortedImages: Rule = {
  id: 'bp-image-aspect',
  title: 'Stretched or squashed images',
  category: 'practices',
  needs: 'rendered',
  verified: true,
  description: 'Images displayed at a different aspect ratio than their real one.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) for (const i of facts.practices?.distortedImages ?? []) ev.push(el(page, 'desktop', i, truncate(i.src, 100), `${i.natural} image shown at ${i.rendered}`));
    if (!ev.length) return [];
    return [{ severity: ev.length >= 3 ? 'medium' : 'low', confidence: 0.9, description: `${plural(ev.length, 'image')} are stretched or squashed because the displayed shape does not match the image.`, recommendation: 'Set only one of width or height, or add object-fit: cover (crop) or contain (letterbox).', evidence: ev, routes: uniqueRoutes(ev) }];
  },
};

function older(version: string, than: string): boolean {
  const a = version.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const b = than.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

export const libraries: Rule = {
  id: 'bp-libraries',
  title: 'Outdated JavaScript libraries',
  category: 'practices',
  needs: 'rendered',
  verified: true,
  description: 'Libraries with known security issues or end of life: jQuery before 3.5, Lodash before 4.17.21, AngularJS, Moment.js.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let security = false;
    const seen = new Set<string>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const lib of facts.practices?.libraries ?? []) {
        const key = `${lib.name}@${lib.version}`;
        if (seen.has(key)) continue;
        let why = '';
        if (lib.name === 'jQuery' && older(lib.version, '3.5.0')) why = 'cross-site scripting issues fixed in 3.5.0 (CVE-2020-11022, CVE-2020-11023)';
        if (lib.name === 'Lodash' && older(lib.version, '4.17.21')) why = 'command injection fixed in 4.17.21 (CVE-2021-23337)';
        if (lib.name === 'AngularJS') why = 'end of life since January 2022, no security fixes';
        if (lib.name === 'Moment.js') why = 'in maintenance mode; large and not tree-shakeable';
        if (!why) continue;
        seen.add(key);
        if (lib.name !== 'Moment.js') security = true;
        ev.push(m(page.path, `${key}: ${why}`));
      }
    }
    if (!ev.length) return [];
    return [{ severity: security ? 'medium' : 'low', confidence: 0.85, description: `${plural(ev.length, 'library')} on this site ${ev.length === 1 ? 'is' : 'are'} outdated: ${ev.map((e) => e.detail?.split(':')[0]).join(', ')}.`, recommendation: 'Upgrade to a current release, or replace with native browser APIs (fetch, querySelector, Intl.DateTimeFormat) where the library is only used lightly.', evidence: ev, routes: uniqueRoutes(ev) }];
  },
};

export const favicon: Rule = {
  id: 'bp-favicon',
  title: 'No favicon',
  category: 'practices',
  needs: 'rendered',
  verified: true,
  penalty: 20,
  description: 'No icon declared and no /favicon.ico, so tabs and bookmarks show a blank page icon.',
  run({ crawl }) {
    const pages = pagesWith(crawl, 'desktop').filter(({ facts }) => facts.practices && !facts.practices.favicon);
    if (!pages.length || pages.length < pagesWith(crawl, 'desktop').length) return [];
    const icoFailed = (crawl?.pages ?? []).some((p) => p.failedRequests.some((r) => /\/favicon\.ico$/.test(r.url)));
    const icoServed = (crawl?.pages ?? []).some((p) => (p.resources ?? []).some((r) => /\/favicon\.ico$/.test(r.url) && r.status === 200));
    if (icoServed || !icoFailed) return [];
    return [{ severity: 'low', confidence: 0.85, description: 'The site declares no icon and /favicon.ico does not load, so browser tabs, bookmarks, and search results show a generic icon.', recommendation: 'Add an SVG or PNG icon with <link rel="icon" href="/icon.svg"> and an apple-touch-icon for iOS.', evidence: [m(pages[0].page.path, 'no <link rel="icon">; /favicon.ico failed')] }];
  },
};

export const practiceRules: Rule[] = [https, documentMode, distortedImages, libraries, favicon];
