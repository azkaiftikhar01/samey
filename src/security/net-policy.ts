import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * Network policy for everything samey fetches, in the browser or from Node.
 *
 * Remote audits may only reach public addresses. Loopback and private ranges need an
 * explicit development mode. Link-local, reserved, and cloud metadata addresses are never
 * reachable. Every hostname is resolved before connecting, every resolved address must be
 * allowed, and the connection is pinned to the address that was checked, so a DNS answer
 * cannot change between validation and use (DNS rebinding).
 */
export type AddressKind = 'public' | 'loopback' | 'private' | 'link-local' | 'reserved' | 'metadata';

export interface NetworkPolicy {
  allowLoopback: boolean;
  allowPrivate: boolean;
  /** Test seam: replaces DNS resolution. */
  resolver?: (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]>;
  /** Test seam: overrides address classification. */
  classify?: (ip: string) => AddressKind;
}

export const REMOTE_POLICY: NetworkPolicy = { allowLoopback: false, allowPrivate: false };
export const DEV_POLICY: NetworkPolicy = { allowLoopback: true, allowPrivate: true };

export class BlockedError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
  }
}

const METADATA = new Set(['169.254.169.254', '100.100.100.200', '168.63.129.16', 'fd00:ec2::254']);

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_RANGES: [string, number, AddressKind][] = [
  ['0.0.0.0', 8, 'reserved'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'private'], // carrier-grade NAT
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'],
  ['192.0.2.0', 24, 'reserved'],
  ['192.88.99.0', 24, 'reserved'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'reserved'],
  ['198.51.100.0', 24, 'reserved'],
  ['203.0.113.0', 24, 'reserved'],
  ['224.0.0.0', 4, 'reserved'], // multicast
  ['240.0.0.0', 4, 'reserved'], // includes 255.255.255.255
];

function classifyV4(ip: string): AddressKind {
  if (METADATA.has(ip)) return 'metadata';
  const n = v4ToInt(ip);
  for (const [base, bits, kind] of V4_RANGES) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((n & mask) === (v4ToInt(base) & mask)) return kind;
  }
  return 'public';
}

/** Expands an IPv6 address to eight 16-bit groups, handling `::` and an embedded dotted IPv4 tail. */
export function expandV6(ip: string): number[] {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.includes('::') ? s.split('::') : [s, undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  return [...h, ...Array(fill).fill('0'), ...t].map((g) => parseInt(g, 16) || 0);
}

function classifyV6(ip: string): AddressKind {
  const g = expandV6(ip);
  const compact = g.map((x) => x.toString(16)).join(':');
  if (METADATA.has(ip.toLowerCase()) || compact === 'fd00:ec2:0:0:0:0:0:254') return 'metadata';
  const embedded = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (g.every((x) => x === 0)) return 'reserved'; // ::
  if (zeroPrefix(7) && g[7] === 1) return 'loopback'; // ::1
  if (zeroPrefix(5) && g[5] === 0xffff) return classifyV4(embedded(g[6], g[7])); // ::ffff:a.b.c.d mapped
  if (zeroPrefix(6)) return 'reserved'; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return classifyV4(embedded(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return classifyV4(embedded(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return 'reserved'; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return 'reserved'; // documentation
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return 'reserved'; // discard
  if ((g[0] & 0xfe00) === 0xfc00) return 'private'; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((g[0] & 0xffc0) === 0xfec0) return 'private'; // deprecated site-local
  if ((g[0] & 0xff00) === 0xff00) return 'reserved'; // multicast
  return 'public';
}

export function classifyIp(ip: string): AddressKind {
  const bare = ip.replace(/^\[|\]$/g, '');
  const v = net.isIP(bare);
  if (v === 4) return classifyV4(bare);
  if (v === 6) return classifyV6(bare);
  return 'reserved';
}

export function kindAllowed(kind: AddressKind, policy: NetworkPolicy): boolean {
  if (kind === 'public') return true;
  if (kind === 'loopback') return policy.allowLoopback;
  if (kind === 'private') return policy.allowPrivate;
  return false;
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

/** Syntax checks that need no network: scheme, credentials, literal addresses, localhost names. */
export function checkUrlSyntax(raw: string | URL, policy: NetworkPolicy): URL {
  let u: URL;
  try {
    u = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    throw new BlockedError(`Not a valid URL: ${String(raw)}`, String(raw));
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedError(`Only http and https URLs are allowed (got ${u.protocol})`, u.href);
  if (u.username || u.password) throw new BlockedError('URLs with embedded credentials are not allowed', u.origin);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!policy.allowLoopback) throw new BlockedError(`${host} is a loopback address`, u.href);
  }
  if (net.isIP(host)) {
    const kind = (policy.classify ?? classifyIp)(host);
    if (!kindAllowed(kind, policy)) throw new BlockedError(`${host} is a ${kind} address`, u.href);
  }
  return u;
}

/**
 * Resolves the URL's host and checks every address. All addresses must be allowed: a name
 * that resolves to both a public and a private address is rejected, because the client
 * cannot control which one a later lookup returns.
 */
export async function resolveTarget(raw: string | URL, policy: NetworkPolicy): Promise<ResolvedTarget> {
  const u = checkUrlSyntax(raw, policy);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const classify = policy.classify ?? classifyIp;
  let addrs: { address: string; family: 4 | 6 }[];
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) as 4 | 6 }];
  else {
    try {
      addrs = policy.resolver ? await policy.resolver(host) : ((await dnsLookup(host, { all: true, verbatim: true })) as { address: string; family: 4 | 6 }[]);
    } catch (err) {
      throw new BlockedError(`Could not resolve ${host}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`, u.href);
    }
  }
  if (!addrs.length) throw new BlockedError(`${host} did not resolve to any address`, u.href);
  for (const a of addrs) {
    const kind = classify(a.address);
    if (!kindAllowed(kind, policy)) throw new BlockedError(`${host} resolves to ${a.address}, a ${kind} address`, u.href);
  }
  return { url: u, address: addrs[0].address, family: addrs[0].family };
}

/** Removes credentials, query, and fragment so a URL is safe to show in reports and logs. */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return raw.replace(/\?.*$/, '');
  }
}
