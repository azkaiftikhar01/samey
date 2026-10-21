import type { BrowserContext, Route } from 'playwright';
import { guardedRequest, TooLargeError } from '../security/fetch.js';
import { BlockedError, checkUrlSyntax, displayUrl, type NetworkPolicy } from '../security/net-policy.js';

export interface NetworkLimits {
  maxResponseBytes: number;
  maxTotalBytes: number;
  maxRequests: number;
  requestTimeoutMs: number;
}

export const DEFAULT_LIMITS: NetworkLimits = {
  maxResponseBytes: 20 * 1024 * 1024,
  maxTotalBytes: 250 * 1024 * 1024,
  maxRequests: 3000,
  requestTimeoutMs: 20_000,
};

export interface NetworkLog {
  blocked: { url: string; reason: string }[];
  /**
   * Navigation redirects the guard stopped, keyed by the requesting URL. Chromium follows a
   * redirect from a fulfilled route without routing the next hop, so navigations are aborted
   * here and the crawler re-navigates to the validated target itself.
   */
  navRedirects: Map<string, string>;
  /** Full URLs the guard refused. Their failures are samey's doing, not the site's. */
  blockedUrls: Set<string>;
  requests: number;
  bytes: number;
  budgetExceeded: boolean;
}

export function newNetworkLog(): NetworkLog {
  return { blocked: [], navRedirects: new Map(), blockedUrls: new Set(), requests: 0, bytes: 0, budgetExceeded: false };
}

/**
 * Serves every browser request from Node through the guarded client, so the browser never
 * resolves DNS or opens a connection on its own. Blocked requests are aborted and logged.
 * Shared state (budget, log) spans all contexts of one crawl.
 */
export async function guardContext(context: BrowserContext, policy: NetworkPolicy, limits: NetworkLimits, log: NetworkLog): Promise<void> {
  const block = async (route: Route, url: string, reason: string, code: 'blockedbyclient' | 'failed' = 'blockedbyclient') => {
    log.blockedUrls.add(url);
    if (log.blocked.length < 200) log.blocked.push({ url: displayUrl(url), reason });
    await route.abort(code).catch(() => undefined);
  };

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (!/^https?:/i.test(url)) return block(route, url, 'unsupported protocol');
    if (log.requests >= limits.maxRequests || log.bytes >= limits.maxTotalBytes) {
      log.budgetExceeded = true;
      return block(route, url, 'crawl network budget exhausted', 'failed');
    }
    log.requests++;
    try {
      const headersIn = await req.allHeaders();
      const send = (u: string, method: string, body: Buffer | null) =>
        guardedRequest(u, { policy, method, headers: headersIn, body, maxBytes: limits.maxResponseBytes, timeoutMs: limits.requestTimeoutMs });
      let res = await send(url, req.method(), req.postDataBuffer());
      const isRedirect = () => res.status >= 300 && res.status < 400 && !!res.headers['location'];
      if (isRedirect() && req.isNavigationRequest()) {
        log.navRedirects.set(url, new URL(String(res.headers['location']), url).href);
        await route.abort('aborted').catch(() => undefined);
        return;
      }
      // Subresources: follow redirects here, re-validating every hop, and hand back the final response.
      let current = url;
      for (let hop = 0; isRedirect(); hop++) {
        if (hop >= 5) throw new BlockedError('more than 5 redirects', url);
        current = new URL(String(res.headers['location']), current).href;
        const keep = res.status === 307 || res.status === 308;
        res = await send(current, keep ? req.method() : 'GET', keep ? req.postDataBuffer() : null);
      }
      log.bytes += res.body.length;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (['transfer-encoding', 'connection', 'keep-alive'].includes(k)) continue;
        headers[k] = Array.isArray(v) ? v.join('\n') : v;
      }
      await route.fulfill({ status: res.status, headers, body: res.body });
    } catch (err) {
      if (err instanceof BlockedError) return block(route, url, err.message);
      if (err instanceof TooLargeError) return block(route, url, err.message, 'failed');
      await route.abort('failed').catch(() => undefined);
    }
  });

  // WebSockets bypass request routing. Remote audits never need them; dev servers use them for hot reload.
  await context.routeWebSocket(/.*/, (ws) => {
    try {
      checkUrlSyntax(ws.url().replace(/^ws/, 'http'), policy);
      if (policy.allowLoopback) {
        ws.connectToServer();
        return;
      }
    } catch {
      /* fall through */
    }
    if (log.blocked.length < 200) log.blocked.push({ url: displayUrl(ws.url().replace(/^ws/, 'http')), reason: 'websocket' });
    ws.close();
  });

  context.on('page', (p) => {
    // Pages opened by the site (window.open, target=_blank clicks) are closed immediately.
    p.opener()
      .then((opener) => (opener ? p.close() : undefined))
      .catch(() => undefined);
  });
}
