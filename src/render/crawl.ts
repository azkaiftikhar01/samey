import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { guardedFetch } from '../security/fetch.js';
import { displayUrl, type NetworkPolicy } from '../security/net-policy.js';
import type { CrawlResult, PageFacts, ViewportFacts, ViewportName } from '../types.js';
import { extractViewportFacts } from './extract.js';
import { testInteractions } from './interact.js';
import { DEFAULT_LIMITS, guardContext, newNetworkLog, type NetworkLimits } from './network.js';
import { isAllowed, parseRobots, type RobotsRules } from './robots.js';

export interface CrawlOptions {
  startUrl: string;
  maxRoutes: number;
  navTimeoutMs: number;
  pageTimeoutMs: number;
  seeds: string[];
  shotsDir?: string;
  interact: boolean;
  respectRobots: boolean;
  policy: NetworkPolicy;
  limits?: NetworkLimits;
  onProgress?: (message: string) => void;
}

export const VIEWPORTS: Record<ViewportName, { width: number; height: number; isMobile: boolean }> = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};

const MAX_SHOT_HEIGHT = { desktop: 5000, mobile: 6000 };
const SKIP_EXT = /\.(?:pdf|zip|gz|tar|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|woff2?|ttf|css|js|mjs|json|xml|txt|csv|docx?|xlsx?|pptx?)$/i;

export class BrowserMissingError extends Error {}

/**
 * In remote mode every request is served from Node by the network guard. Anything Chromium
 * tries to send on its own (preconnects, WebRTC) is pointed at a closed local port so it
 * cannot reach the network.
 */
export async function launchBrowser(policy: NetworkPolicy): Promise<Browser> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new BrowserMissingError('Playwright is not installed. Run `npm install playwright` in the unslop package.');
  }
  try {
    return await chromium.launch({
      headless: true,
      args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--dns-prefetch-disable', '--disable-features=NetworkPrediction'],
      proxy: policy.allowLoopback ? undefined : { server: 'http://127.0.0.1:9' },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/Executable doesn't exist|browserType.launch/i.test(msg)) {
      throw new BrowserMissingError('Chromium for Playwright is not installed. Run `npx playwright install chromium`, or use --static-only.');
    }
    throw err;
  }
}

/** Canonical key for a URL: origin + path without trailing slash, no query or hash. */
export function urlKey(u: URL): string {
  const p = u.pathname.replace(/\/index\.html?$/, '/').replace(/\/+$/, '') || '/';
  return u.origin + p;
}

export function normalizeLink(href: string, base: string): URL | null {
  if (!href || /^(?:mailto|tel|javascript|data|blob|sms|ftp):/i.test(href) || href.startsWith('#')) return null;
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.search = '';
    return u;
  } catch {
    return null;
  }
}

function slug(p: string): string {
  return (p.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'home').slice(0, 60);
}

async function settle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
  // Scroll through once so lazy-loaded content and intersection-triggered animations resolve.
  await page
    .evaluate(async () => {
      const step = window.innerHeight;
      const max = Math.min(document.documentElement.scrollHeight, step * 15);
      for (let y = 0; y < max; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 150));
    })
    .catch(() => undefined);
}

async function capture(page: Page, viewport: ViewportName, file: string | undefined): Promise<number | undefined> {
  if (!file) return undefined;
  const { width } = VIEWPORTS[viewport];
  const docHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900);
  const height = Math.max(1, Math.min(docHeight, MAX_SHOT_HEIGHT[viewport]));
  await page.screenshot({ path: file, type: 'jpeg', quality: 60, fullPage: true, clip: { x: 0, y: 0, width, height }, animations: 'disabled', timeout: 20_000 });
  return height;
}

interface Listeners {
  consoleErrors: string[];
  failedRequests: PageFacts['failedRequests'];
}

function attach(page: Page, origin: string, sink: Listeners): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error' && sink.consoleErrors.length < 30) sink.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => {
    if (sink.consoleErrors.length < 30) sink.consoleErrors.push(`Uncaught: ${err.message.slice(0, 280)}`);
  });
  page.on('response', (res) => {
    const status = res.status();
    if (status < 400) return;
    const req = res.request();
    const sameOrigin = res.url().startsWith(origin);
    if ((sameOrigin || ['document', 'script', 'stylesheet'].includes(req.resourceType())) && sink.failedRequests.length < 40) {
      sink.failedRequests.push({ url: res.url(), status, resourceType: req.resourceType() });
    }
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? 'failed';
    if (/ERR_ABORTED|cancelled/i.test(failure)) return;
    if (sink.failedRequests.length < 40) sink.failedRequests.push({ url: req.url(), failure, resourceType: req.resourceType() });
  });
}

async function auditViewport(
  context: BrowserContext,
  url: string,
  viewport: ViewportName,
  opts: CrawlOptions,
  sink: Listeners,
  shotFile: string | undefined,
): Promise<{ facts?: ViewportFacts; status: number | null; error?: string; finalUrl: string; contentType?: string; page: Page }> {
  const page = await context.newPage();
  page.setDefaultTimeout(opts.pageTimeoutMs);
  attach(page, new URL(opts.startUrl).origin, sink);
  let status: number | null = null;
  let contentType: string | undefined;
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: opts.navTimeoutMs });
    status = res?.status() ?? null;
    contentType = res?.headers()['content-type'];
    if (contentType && !/html/i.test(contentType)) return { status, finalUrl: page.url(), contentType, page };
    await settle(page, opts.pageTimeoutMs);
    const facts = await extractViewportFacts(page, viewport);
    try {
      const h = await capture(page, viewport, shotFile);
      if (h && shotFile) {
        facts.screenshot = path.basename(shotFile);
        facts.screenshotHeight = h;
      }
    } catch {
      // A failed screenshot should not lose the extracted facts.
    }
    return { facts, status, finalUrl: page.url(), contentType, page };
  } catch (err) {
    return { status, error: (err as Error).message.split('\n')[0].slice(0, 300), finalUrl: page.url(), contentType, page };
  }
}

export async function crawl(browser: Browser, opts: CrawlOptions): Promise<CrawlResult> {
  const start = new URL(opts.startUrl);
  const origin = start.origin;
  if (opts.shotsDir) mkdirSync(opts.shotsDir, { recursive: true });

  const common = { reducedMotion: 'reduce' as const, acceptDownloads: false, serviceWorkers: 'block' as const };
  const desktop = await browser.newContext({ ...common, viewport: { width: VIEWPORTS.desktop.width, height: VIEWPORTS.desktop.height } });
  const mobile = await browser.newContext({
    ...common,
    viewport: { width: VIEWPORTS.mobile.width, height: VIEWPORTS.mobile.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 unslop',
  });

  const limits = opts.limits ?? DEFAULT_LIMITS;
  const network = newNetworkLog();
  await guardContext(desktop, opts.policy, limits, network);
  await guardContext(mobile, opts.policy, limits, network);
  const fetchOpts = { policy: opts.policy, maxBytes: 2 * 1024 * 1024, timeoutMs: Math.min(opts.navTimeoutMs, 10_000), headers: { 'user-agent': 'unslop' } };

  const result: CrawlResult = { baseUrl: opts.startUrl, pages: [], skipped: [], brokenLinks: [], discovered: 0, limitHit: false, network };

  let robots: RobotsRules = { allow: [], disallow: [] };
  if (opts.respectRobots) {
    const res = await guardedFetch(origin + '/robots.txt', fetchOpts).catch(() => null);
    if (res && res.status === 200) robots = parseRobots(res.body.toString('utf8'));
  }

  const queue: URL[] = [];
  const seen = new Set<string>();
  const referrer = new Map<string, string>();
  const enqueue = (u: URL | null, from?: string) => {
    if (!u || u.origin !== origin || SKIP_EXT.test(u.pathname)) return;
    const key = urlKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    if (from) referrer.set(key, from);
    queue.push(u);
  };

  enqueue(normalizeLink(opts.startUrl, opts.startUrl));
  for (const s of opts.seeds) enqueue(normalizeLink(s, opts.startUrl), '(route hint)');
  const sitemap = await guardedFetch(origin + '/sitemap.xml', fetchOpts).catch(() => null);
  if (sitemap && sitemap.status === 200 && /xml/i.test(String(sitemap.headers['content-type'] ?? ''))) {
    const xml = sitemap.body.toString('utf8');
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) enqueue(normalizeLink(m[1], opts.startUrl), '(sitemap)');
  }

  const crawled = new Set<string>();
  while (queue.length && result.pages.length < opts.maxRoutes) {
    const u = queue.shift()!;
    const key = urlKey(u);
    if (opts.respectRobots && !isAllowed(robots, u.pathname)) {
      result.skipped.push({ url: u.href, reason: 'disallowed by robots.txt' });
      continue;
    }
    opts.onProgress?.(`Auditing ${u.pathname} (page ${result.pages.length + 1}, limit ${opts.maxRoutes})`);
    const sink: Listeners = { consoleErrors: [], failedRequests: [] };
    const begin = Date.now();
    const shot = (vp: ViewportName) => (opts.shotsDir ? path.join(opts.shotsDir, `${String(result.pages.length + 1).padStart(2, '0')}-${slug(u.pathname)}-${vp}.jpg`) : undefined);

    const d = await auditViewport(desktop, u.href, 'desktop', opts, sink, shot('desktop'));
    if (d.contentType && !/html/i.test(d.contentType)) {
      result.skipped.push({ url: u.href, reason: `not an HTML page (${d.contentType.split(';')[0]})` });
      await d.page.close();
      continue;
    }
    const landed = new URL(d.finalUrl || u.href);
    if (landed.origin !== origin && landed.protocol.startsWith('http')) {
      result.skipped.push({ url: u.href, reason: `redirected to another site (${displayUrl(landed.href)})` });
      await d.page.close();
      continue;
    }
    crawled.add(key);
    const facts: PageFacts = {
      url: u.href,
      path: u.pathname,
      status: d.status,
      loadMs: 0,
      error: d.error,
      consoleErrors: sink.consoleErrors,
      failedRequests: sink.failedRequests,
      // Error pages are reported as broken links; their content is not audited as a real page.
      desktop: (d.status ?? 200) < 400 ? d.facts : undefined,
      interactions: [],
    };
    const finalUrl = new URL(d.finalUrl || u.href);
    if (urlKey(finalUrl) !== key) crawled.add(urlKey(finalUrl));

    if (d.facts) {
      for (const link of d.facts.links) if (link.internal) enqueue(normalizeLink(link.href, d.finalUrl || u.href), u.pathname);
      if (opts.interact && (d.status ?? 200) < 400) {
        facts.interactions = await testInteractions(d.page, d.facts.controls, 6, opts.pageTimeoutMs).catch(() => []);
      }
    }
    await d.page.close();
    facts.loadMs = Date.now() - begin;

    if (!d.error && (d.status ?? 200) < 400) {
      const m = await auditViewport(mobile, u.href, 'mobile', opts, sink, shot('mobile'));
      facts.mobile = m.facts;
      if (m.error && !facts.error) facts.error = `mobile: ${m.error}`;
      await m.page.close();
    }
    facts.consoleErrors = [...new Set(sink.consoleErrors)];
    const seenReq = new Set<string>();
    facts.failedRequests = sink.failedRequests.filter((r) => !seenReq.has(r.url) && !!seenReq.add(r.url));
    result.pages.push(facts);
  }

  result.limitHit = queue.length > 0;
  result.discovered = seen.size;
  for (const u of queue) result.skipped.push({ url: u.href, reason: `route limit (${opts.maxRoutes}) reached` });

  // Broken internal links: crawled pages that returned errors, plus a bounded status check of the rest.
  for (const p of result.pages) {
    if (p.status !== null && p.status >= 400) {
      result.brokenLinks.push({ from: referrer.get(urlKey(new URL(p.url))) ?? '(start url)', url: p.url, status: p.status });
    }
  }
  const unchecked = queue.slice(0, 40);
  for (const u of unchecked) {
    const res = await guardedFetch(u.href, fetchOpts).catch((e: Error) => e);
    if (res instanceof Error) {
      // Too large is not broken; it just was not worth downloading for a status check.
      if (!/byte limit/.test(res.message)) result.brokenLinks.push({ from: referrer.get(urlKey(u)) ?? '?', url: u.href, status: null, error: res.message.split('\n')[0] });
    } else if (res.status >= 400) result.brokenLinks.push({ from: referrer.get(urlKey(u)) ?? '?', url: u.href, status: res.status });
  }

  await desktop.close();
  await mobile.close();
  return result;
}
