import type { CrawlResult, Evidence, ResourceFact } from '../types.js';
import { truncate } from '../util/text.js';
import { el, pagesWith, plural, uniqueRoutes } from './helpers.js';
import type { FindingInput, Rule } from './types.js';

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Local dev and static servers rarely compress or set cache headers; those checks only apply to deployed sites. */
export function isLocalCrawl(crawl: CrawlResult | undefined): boolean {
  if (!crawl) return true;
  try {
    const h = new URL(crawl.baseUrl).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h) || /^(?:10|192\.168)\./.test(h);
  } catch {
    return true;
  }
}

const resources = (crawl: CrawlResult | undefined) => (crawl?.pages ?? []).filter((p) => p.desktop && p.resources?.length).map((p) => ({ page: p, res: p.resources as ResourceFact[] }));

const metric = (route: string, detail: string, metricData?: Record<string, number | string>): Evidence => ({ type: 'metric', route, detail, metric: metricData });

export const pageWeight: Rule = {
  id: 'perf-page-weight',
  title: 'Heavy pages',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'Pages that download more than 3 MB.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let worst = 0;
    for (const { page, res } of resources(crawl)) {
      const total = res.reduce((s, r) => s + r.bytes, 0);
      if (total < 3 * 1024 * 1024) continue;
      worst = Math.max(worst, total);
      const top = [...res].sort((a, b) => b.bytes - a.bytes).slice(0, 3).map((r) => `${truncate(r.url.split('?')[0], 70)} (${kb(r.bytes)})`);
      ev.push(metric(page.path, `${kb(total)} across ${res.length} requests. Largest: ${top.join(', ')}`, { bytes: total, requests: res.length }));
    }
    if (!ev.length) return [];
    return [
      {
        severity: worst >= 6 * 1024 * 1024 ? 'high' : 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'page')} download more than 3 MB (the heaviest is ${kb(worst)}). On a phone connection that is several seconds of waiting before the page is usable.`,
        recommendation: 'Start with the largest files listed: compress and resize images, serve video only on demand, and split or drop large scripts.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const javascriptWeight: Rule = {
  id: 'perf-javascript',
  title: 'Too much JavaScript',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'Pages loading more than 1 MB of uncompressed JavaScript.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let worst = 0;
    for (const { page, res } of resources(crawl)) {
      const js = res.filter((r) => r.type === 'script');
      const total = js.reduce((s, r) => s + r.bytes, 0);
      if (total < 1024 * 1024) continue;
      worst = Math.max(worst, total);
      const top = [...js].sort((a, b) => b.bytes - a.bytes).slice(0, 3).map((r) => `${truncate(r.url.split('?')[0], 70)} (${kb(r.bytes)})`);
      ev.push(metric(page.path, `${kb(total)} of JavaScript in ${js.length} files. Largest: ${top.join(', ')}`, { bytes: total, files: js.length }));
    }
    if (!ev.length) return [];
    return [
      {
        severity: worst >= 2 * 1024 * 1024 ? 'high' : 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'page')} load more than 1 MB of JavaScript (uncompressed). Every byte has to be parsed and run before the page responds, which is slowest on mid-range phones.`,
        recommendation: 'Code-split by route, lazy-load components below the fold, and replace heavy libraries with smaller ones or native APIs.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const oversizedImages: Rule = {
  id: 'perf-images',
  title: 'Oversized and unoptimized images',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'Images much larger than displayed, or large JPEG/PNG files that would be far smaller as WebP or AVIF.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let wasted = 0;
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const bytesOf = new Map((page.resources ?? []).map((r) => [r.url, r] as const));
      for (const img of facts.perf?.images ?? []) {
        const r = bytesOf.get(img.src);
        if (!r || r.bytes < 100 * 1024) continue;
        const scale = img.naturalW / Math.max(1, img.rect.width);
        const oldFormat = /image\/(?:jpe?g|png)/i.test(r.contentType ?? '') || /\.(?:jpe?g|png)(?:$|\?)/i.test(img.src);
        if (scale > 2.5) {
          wasted += r.bytes * (1 - 1 / (scale * scale));
          ev.push(el(page, 'desktop', img, truncate(img.src, 100), `${img.naturalW}x${img.naturalH} image shown at ${img.rect.width}x${img.rect.height} (${kb(r.bytes)})`));
        } else if (oldFormat && r.bytes > 200 * 1024) {
          wasted += r.bytes * 0.3;
          ev.push(el(page, 'desktop', img, truncate(img.src, 100), `${kb(r.bytes)} ${/png/i.test(r.contentType ?? img.src) ? 'PNG' : 'JPEG'}; WebP or AVIF is usually 25-50% smaller`));
        }
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: wasted > 1024 * 1024 ? 'medium' : 'low',
        confidence: 0.85,
        description: `${plural(ev.length, 'image')} are larger than they need to be, roughly ${kb(wasted)} that could be saved.`,
        recommendation: 'Serve images at the size they are displayed (2x for high-density screens is enough) using srcset, and convert large JPEG and PNG files to WebP or AVIF. Framework image components (next/image, astro:assets) do both.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const lcpLazy: Rule = {
  id: 'perf-lcp-lazy',
  title: 'Main image is lazy-loaded',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'The largest element on screen is an image with loading="lazy", which delays the main content.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const lcp = facts.perf?.lcp;
      if (lcp?.tag === 'img' && lcp.lazy) ev.push(el(page, 'desktop', lcp, lcp.src ? truncate(lcp.src, 100) : undefined, 'largest contentful element, loading="lazy"'));
    }
    if (!ev.length) return [];
    return [
      {
        severity: 'medium',
        confidence: 0.9,
        description: `On ${plural(ev.length, 'page')} the largest visible element is a lazy-loaded image. The browser waits to fetch it, so the main content appears later.`,
        recommendation: 'Remove loading="lazy" from above-the-fold images and add fetchpriority="high" to the main one.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const layoutShift: Rule = {
  id: 'perf-layout-shift',
  title: 'Content jumps while loading',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'Cumulative Layout Shift above 0.1, or images without dimensions that cause it.',
  run({ crawl }) {
    const out: FindingInput[] = [];
    const ev: Evidence[] = [];
    let worst = 0;
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const p = facts.perf;
      if (!p || p.cls <= 0.1) continue;
      worst = Math.max(worst, p.cls);
      ev.push(metric(page.path, `Cumulative Layout Shift ${p.cls}`, { cls: p.cls }));
      for (const s of p.clsSources.slice(0, 3)) ev.push(el(page, 'desktop', s, undefined, `moved during load (shift ${s.value})`));
    }
    if (ev.length)
      out.push({
        severity: worst > 0.25 ? 'high' : 'medium',
        confidence: 0.85,
        description: `Content moves while ${plural(uniqueRoutes(ev).length, 'page')} load (worst CLS ${worst}; Google's threshold for good is 0.1). People lose their place or tap the wrong thing.`,
        recommendation: 'Reserve space for anything that loads late: width and height on images and video, a min-height on embeds and ad slots, and font-display: optional or size-adjusted fallbacks for web fonts.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      });
    const noDims: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) for (const img of facts.perf?.images ?? []) if (!img.hasDims && img.rect.height > 40) noDims.push(el(page, 'desktop', img, truncate(img.src, 100), 'no width/height or aspect-ratio'));
    if (noDims.length >= 3)
      out.push({
        title: 'Images without dimensions',
        severity: 'low',
        confidence: 0.9,
        description: `${plural(noDims.length, 'image')} have no width and height attributes or CSS aspect-ratio, so the page reflows when each one loads.`,
        recommendation: 'Add width and height attributes matching the image ratio (CSS can still make it responsive), or set aspect-ratio in CSS.',
        evidence: noDims,
        routes: uniqueRoutes(noDims),
      });
    return out;
  },
};

export const mainThread: Rule = {
  id: 'perf-main-thread',
  title: 'Main thread blocked by long tasks',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'More than 300 ms of main-thread blocking during load (sum of long-task time over 50 ms).',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let worst = 0;
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const p = facts.perf;
      if (!p || p.blockingMs <= 300) continue;
      worst = Math.max(worst, p.blockingMs);
      ev.push(metric(page.path, `${p.blockingMs} ms blocked across ${plural(p.longTasks, 'long task')}`, { blockingMs: p.blockingMs, longTasks: p.longTasks }));
    }
    if (!ev.length) return [];
    return [
      {
        severity: worst > 600 ? 'high' : 'medium',
        confidence: 0.7,
        description: `${plural(ev.length, 'page')} block the main thread for more than 300 ms while loading (worst ${worst} ms, measured on a fast desktop CPU, so phones will be several times slower). Taps and scrolls wait until it finishes.`,
        recommendation: 'Find the long tasks in the browser Performance panel. Usual causes: large hydration bundles, synchronous third-party scripts, and heavy work in effects on mount. Defer, split, or move work to a web worker.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const renderBlocking: Rule = {
  id: 'perf-render-blocking',
  title: 'Render-blocking scripts',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'Scripts in <head> without async or defer, which stop the page from rendering until they download and run.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const r of facts.perf?.renderBlocking ?? []) if (r.kind === 'script') ev.push({ type: 'network', route: page.path, excerpt: truncate(r.url, 140), detail: 'synchronous <script> in <head>' });
      const css = (facts.perf?.renderBlocking ?? []).filter((r) => r.kind === 'stylesheet');
      if (css.length > 4) ev.push(metric(page.path, `${css.length} separate stylesheets in <head>, each blocking first render`));
    }
    if (!ev.length) return [];
    return [
      {
        severity: new Set(ev.filter((e) => e.type === 'network').map((e) => e.excerpt)).size >= 3 ? 'medium' : 'low',
        confidence: 0.9,
        description: `${plural(new Set(ev.map((e) => e.excerpt ?? e.detail)).size, 'resource')} block the first render on ${plural(uniqueRoutes(ev).length, 'page')}.`,
        recommendation: 'Add defer (or async for independent scripts) to <head> scripts, and combine or inline critical CSS.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const domSize: Rule = {
  id: 'perf-dom-size',
  title: 'Very large DOM',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  penalty: 25,
  description: 'Pages with more than 1,500 elements, which slows styling, layout, and every interaction.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let worst = 0;
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const n = facts.perf?.domNodes ?? 0;
      if (n <= 1500) continue;
      worst = Math.max(worst, n);
      ev.push(metric(page.path, `${n} elements, nested ${facts.perf?.domDepth} deep`, { elements: n }));
    }
    if (!ev.length) return [];
    return [
      {
        severity: worst > 3000 ? 'medium' : 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'page')} have more than 1,500 elements (largest ${worst}).`,
        recommendation: 'Virtualize long lists, render off-screen tabs and accordions on demand, and remove wrapper elements that only exist for styling.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

const TEXT_TYPES = /javascript|ecmascript|css|html|json|xml|svg|text\/plain/i;

export const compression: Rule = {
  id: 'perf-compression',
  title: 'Text files served without compression',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  description: 'Scripts, styles, and HTML over 4 KB sent without gzip or Brotli. Deployed sites only.',
  run({ crawl }) {
    if (isLocalCrawl(crawl)) return [];
    const ev: Evidence[] = [];
    const seen = new Set<string>();
    for (const { page, res } of resources(crawl)) {
      for (const r of res) {
        if (seen.has(r.url) || r.bytes < 4096 || r.encoding || !TEXT_TYPES.test(r.contentType ?? '') || r.status >= 300) continue;
        seen.add(r.url);
        ev.push({ type: 'network', route: page.path, excerpt: truncate(r.url, 140), detail: `${kb(r.bytes)} ${r.contentType?.split(';')[0]}, no Content-Encoding` });
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: ev.length >= 5 ? 'medium' : 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'text file')} are sent uncompressed. Gzip or Brotli typically cuts them by 70% or more.`,
        recommendation: 'Enable Brotli or gzip on the server or CDN for HTML, CSS, JavaScript, JSON, and SVG.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const caching: Rule = {
  id: 'perf-caching',
  title: 'Static files not cached',
  category: 'performance',
  needs: 'rendered',
  verified: true,
  penalty: 25,
  description: 'Same-origin scripts, styles, images, and fonts cached for less than a day. Deployed sites only.',
  run({ crawl }) {
    if (isLocalCrawl(crawl)) return [];
    const ev: Evidence[] = [];
    const seen = new Set<string>();
    for (const { page, res } of resources(crawl)) {
      for (const r of res) {
        if (seen.has(r.url) || !r.sameOrigin || !['script', 'stylesheet', 'image', 'font'].includes(r.type) || r.status !== 200) continue;
        seen.add(r.url);
        const cc = (r.cacheControl ?? '').toLowerCase();
        const maxAge = Number(cc.match(/max-age=(\d+)/)?.[1] ?? 0);
        if (cc.includes('immutable') || maxAge >= 86400) continue;
        ev.push({ type: 'network', route: page.path, excerpt: truncate(r.url, 140), detail: cc ? `Cache-Control: ${cc}` : 'no Cache-Control header' });
      }
    }
    if (ev.length < 3) return [];
    return [
      {
        severity: 'low',
        confidence: 0.85,
        description: `${plural(ev.length, 'static file')} are cached for less than a day, so returning visitors download them again.`,
        recommendation: 'Serve fingerprinted assets (names containing a content hash) with Cache-Control: public, max-age=31536000, immutable.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const performanceRules: Rule[] = [pageWeight, javascriptWeight, oversizedImages, lcpLazy, layoutShift, mainThread, renderBlocking, domSize, compression, caching];
