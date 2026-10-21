import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import zlib from 'node:zlib';
import { BlockedError, resolveTarget, type NetworkPolicy } from './net-policy.js';

export interface GuardedResponse {
  url: string;
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

export interface RequestOptions {
  policy: NetworkPolicy;
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | null;
  maxBytes: number;
  timeoutMs: number;
}

export class TooLargeError extends Error {}

const DROP_REQUEST = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'proxy-authorization', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te']);

/**
 * One HTTP request, no redirects followed. The connection goes to the address that
 * resolveTarget() validated, never to a fresh DNS answer.
 */
export async function guardedRequest(rawUrl: string, opts: RequestOptions): Promise<GuardedResponse> {
  const target = await resolveTarget(rawUrl, opts.policy);
  const lookup: LookupFunction = (_host, options, cb) => {
    if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: target.address, family: target.family }]);
    else cb(null, target.address, target.family);
  };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) if (!DROP_REQUEST.has(k.toLowerCase()) && !k.startsWith(':')) headers[k] = v;
  headers['accept-encoding'] = 'gzip, deflate, br';
  const mod = target.url.protocol === 'https:' ? https : http;

  return new Promise<GuardedResponse>((resolve, reject) => {
    const req = mod.request(
      target.url,
      { method: opts.method ?? 'GET', headers, lookup, timeout: opts.timeoutMs, agent: false },
      (res) => {
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          reject(new TooLargeError(`response is ${declared} bytes, over the ${opts.maxBytes} byte limit`));
          return;
        }
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const stream = enc === 'gzip' || enc === 'x-gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            stream.destroy();
            reject(new TooLargeError(`response exceeded the ${opts.maxBytes} byte limit`));
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () => {
          const out: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out[k] = v;
          if (enc) {
            delete out['content-encoding'];
            delete out['content-length'];
          }
          resolve({ url: target.url.href, status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks) });
        });
        stream.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timed out after ${opts.timeoutMs}ms`)));
    req.on('error', reject);
    if (opts.body && opts.body.length) req.write(opts.body);
    req.end();
  });
}

/** GET with redirects, re-validating every hop against the policy. */
export async function guardedFetch(url: string, opts: RequestOptions & { maxRedirects?: number }): Promise<GuardedResponse> {
  const max = opts.maxRedirects ?? 5;
  const seen = new Set<string>();
  let current = url;
  for (let hop = 0; hop <= max; hop++) {
    if (seen.has(current)) throw new BlockedError(`redirect loop at ${current}`, current);
    seen.add(current);
    const res = await guardedRequest(current, opts);
    const location = res.headers['location'];
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(String(location), current).href;
      continue;
    }
    return res;
  }
  throw new BlockedError(`more than ${max} redirects`, url);
}
