import type { Page } from 'playwright';
import type { PerfFacts, PracticeFacts, SeoFacts } from '../types.js';
import { runInPage } from './extract.js';

/**
 * Installed before any page script runs. Records layout shifts, long tasks, and the largest
 * contentful element as they happen, so they can be read after the page settles.
 */
export const PERF_INIT_SCRIPT = `(() => {
  const s = (window.__sameyPerf = { shifts: [], longTasks: [], lcp: null });
  const watch = (type, cb) => { try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true }); } catch (e) {} };
  watch('layout-shift', (e) => { if (!e.hadRecentInput) s.shifts.push({ value: e.value, t: e.startTime, nodes: (e.sources || []).map((x) => x.node).filter(Boolean) }); });
  watch('longtask', (e) => s.longTasks.push(e.duration));
  watch('largest-contentful-paint', (e) => { if (e.element) s.lcp = e.element; });
})();`;

export interface Extras {
  perf: PerfFacts;
  seo: SeoFacts;
  practices: PracticeFacts;
}

export async function extractExtras(page: Page): Promise<Extras> {
  return runInPage(page, extrasInPage, undefined) as Promise<Extras>;
}

// Runs in the browser. Must not reference anything outside its own body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extrasInPage(): any {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const cssPath = (el: Element): string => {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content') ?? null;

  // --- performance ---
  const all = document.getElementsByTagName('*');
  let depth = 0;
  for (let i = 0; i < Math.min(all.length, 20000); i++) {
    let d = 0;
    for (let p: Element | null = all[i]; p; p = p.parentElement) d++;
    if (d > depth) depth = d;
  }
  const s = (window as unknown as { __sameyPerf?: { shifts: { value: number; t: number; nodes: Node[] }[]; longTasks: number[]; lcp: Element | null } }).__sameyPerf ?? { shifts: [], longTasks: [], lcp: null };
  // CLS: the largest session window (shifts less than 1s apart, window at most 5s), as Chrome defines it.
  let cls = 0;
  let win = 0;
  let start = 0;
  let prev = -Infinity;
  for (const e of [...s.shifts].sort((a, b) => a.t - b.t)) {
    if (e.t - prev > 1000 || e.t - start > 5000) {
      win = 0;
      start = e.t;
    }
    win += e.value;
    prev = e.t;
    if (win > cls) cls = win;
  }
  const clsSources = [...s.shifts]
    .sort((a, b) => b.value - a.value)
    .flatMap((e) => e.nodes.filter((n): n is Element => n instanceof Element && n.isConnected).map((n) => ({ selector: cssPath(n), rect: rectOf(n), value: Math.round(e.value * 1000) / 1000 })))
    .slice(0, 5);
  const blockingMs = Math.round(s.longTasks.reduce((t, d) => t + Math.max(0, d - 50), 0));
  let lcp;
  if (s.lcp && s.lcp.isConnected) {
    const img = s.lcp instanceof HTMLImageElement ? s.lcp : null;
    lcp = { selector: cssPath(s.lcp), rect: rectOf(s.lcp), tag: s.lcp.tagName.toLowerCase(), src: img?.currentSrc || undefined, lazy: img?.loading === 'lazy' };
  }
  const fold = window.innerHeight;
  const images = Array.from(document.images)
    .filter((i) => i.naturalWidth > 0 && i.getBoundingClientRect().width > 0)
    .slice(0, 80)
    .map((i) => {
      const cs = getComputedStyle(i);
      return {
        selector: cssPath(i),
        rect: rectOf(i),
        src: i.currentSrc || i.src,
        naturalW: i.naturalWidth,
        naturalH: i.naturalHeight,
        lazy: i.loading === 'lazy',
        hasDims: (i.hasAttribute('width') && i.hasAttribute('height')) || cs.aspectRatio !== 'auto',
        belowFold: i.getBoundingClientRect().top + sy > fold,
      };
    });
  const renderBlocking = [
    ...Array.from(document.head.querySelectorAll('script[src]'))
      // nomodule scripts never run in modern browsers, and non-JavaScript types are not executed at all.
      .filter((sc) => !sc.hasAttribute('async') && !sc.hasAttribute('defer') && !sc.hasAttribute('nomodule') && /^(?:|text\/javascript|application\/javascript)$/i.test(sc.getAttribute('type') ?? ''))
      .map((sc) => ({ url: (sc as HTMLScriptElement).src, kind: 'script' as const })),
    ...Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'))
      .filter((l) => !/^print$/i.test(l.getAttribute('media') ?? '') && !l.hasAttribute('disabled'))
      .map((l) => ({ url: (l as HTMLLinkElement).href, kind: 'stylesheet' as const })),
  ].slice(0, 40);

  // --- SEO ---
  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .slice(0, 10)
    .map((sc) => {
      try {
        const data = JSON.parse(sc.textContent || '');
        const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
        const types = items.flatMap((x: { '@type'?: string | string[] }) => (Array.isArray(x?.['@type']) ? x['@type'] : x?.['@type'] ? [x['@type']] : []));
        return { valid: true, types: types.slice(0, 8) };
      } catch (err) {
        return { valid: false, types: [], error: String((err as Error).message).slice(0, 120) };
      }
    });
  const uncrawlableLinks = Array.from(document.querySelectorAll('a:not([href])'))
    .filter((a) => a.getAttribute('role') !== 'button' && (a.textContent ?? '').trim().length > 0 && a.getBoundingClientRect().width > 0)
    .slice(0, 20)
    .map((a) => ({ selector: cssPath(a), rect: rectOf(a), text: (a.textContent ?? '').trim().slice(0, 80) }));

  // --- best practices ---
  const distortedImages = Array.from(document.images)
    .filter((i) => {
      const r = i.getBoundingClientRect();
      if (i.naturalWidth < 20 || r.width < 20 || r.height < 20) return false;
      const fit = getComputedStyle(i).objectFit;
      if (fit && fit !== 'fill') return false;
      const natural = i.naturalWidth / i.naturalHeight;
      const shown = r.width / r.height;
      return Math.abs(shown / natural - 1) > 0.05;
    })
    .slice(0, 15)
    .map((i) => {
      const r = i.getBoundingClientRect();
      return { selector: cssPath(i), rect: rectOf(i), src: (i.currentSrc || i.src).slice(0, 200), natural: `${i.naturalWidth}x${i.naturalHeight}`, rendered: `${Math.round(r.width)}x${Math.round(r.height)}` };
    });
  const w = window as unknown as { jQuery?: { fn?: { jquery?: string } }; angular?: { version?: { full?: string } }; moment?: { version?: string }; _?: { VERSION?: string } };
  const libraries: { name: string; version: string }[] = [];
  if (w.jQuery?.fn?.jquery) libraries.push({ name: 'jQuery', version: w.jQuery.fn.jquery });
  if (w.angular?.version?.full) libraries.push({ name: 'AngularJS', version: w.angular.version.full });
  if (w.moment?.version) libraries.push({ name: 'Moment.js', version: w.moment.version });
  if (w._?.VERSION && typeof (w._ as unknown) === 'function') libraries.push({ name: 'Lodash', version: w._.VERSION });

  return {
    perf: { domNodes: all.length, domDepth: depth, cls: Math.round(cls * 1000) / 1000, clsSources, blockingMs, longTasks: s.longTasks.length, lcp, images, renderBlocking },
    seo: {
      canonical: Array.from(document.querySelectorAll('link[rel="canonical"]')).map((l) => (l as HTMLLinkElement).href),
      robots: meta('meta[name="robots" i]') ?? meta('meta[name="googlebot" i]'),
      viewport: meta('meta[name="viewport" i]'),
      og: {
        title: meta('meta[property="og:title"]') ?? undefined,
        description: meta('meta[property="og:description"]') ?? undefined,
        image: meta('meta[property="og:image"]') ?? undefined,
      },
      twitterCard: meta('meta[name="twitter:card"]'),
      jsonLd,
      uncrawlableLinks,
    },
    practices: {
      compatMode: document.compatMode,
      charsetMeta: !!document.querySelector('meta[charset], meta[http-equiv="Content-Type" i]'),
      distortedImages,
      libraries,
      favicon: !!document.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]'),
    },
  };
}
