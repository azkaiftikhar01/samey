import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface AuditOptions {
  /** Local project directory to analyze statically (and serve, if it has a static build). */
  path?: string;
  /** Rendered target. Overrides any local server. */
  url?: string;
  /** Shell command that starts a dev server. Passing it is the authorization to run project code. */
  serve?: string;
  /** Development mode: allows --url to point at loopback and private addresses. */
  dev: boolean;
  /** Test seam: replaces the network policy for the crawl. Never set from the CLI. */
  policyOverride?: import('./security/net-policy.js').NetworkPolicy;
  port: number;
  maxRoutes: number;
  concurrency: number;
  navTimeoutMs: number;
  pageTimeoutMs: number;
  serverTimeoutMs: number;
  outDir: string;
  formats: ('html' | 'json')[];
  screenshots: boolean;
  interact: boolean;
  staticOnly: boolean;
  respectRobots: boolean;
  ignoreRules: string[];
  routes: string[];
  /** Exit 1 when the slop score is above this. */
  failAbove?: number;
  ai: boolean;
  model?: string;
  modelEndpoint: string;
  modelTimeoutMs: number;
  onProgress?: (message: string) => void;
}

export const DEFAULTS: Omit<AuditOptions, 'outDir'> = {
  dev: false,
  port: 4173,
  maxRoutes: 20,
  concurrency: 3,
  navTimeoutMs: 30_000,
  pageTimeoutMs: 20_000,
  serverTimeoutMs: 60_000,
  formats: ['html', 'json'],
  screenshots: true,
  interact: true,
  staticOnly: false,
  respectRobots: true,
  ignoreRules: [],
  routes: [],
  ai: true,
  modelEndpoint: 'http://127.0.0.1:11434',
  modelTimeoutMs: 120_000,
};

/** Keys accepted in samey.config.json. Anything else is rejected so typos surface. */
const FILE_KEYS = new Set(['maxRoutes', 'concurrency', 'navTimeoutMs', 'pageTimeoutMs', 'serverTimeoutMs', 'ignoreRules', 'routes', 'failAbove', 'model', 'modelEndpoint', 'serve', 'port', 'interact', 'respectRobots', 'screenshots']);

export function loadConfigFile(dir: string | undefined): Partial<AuditOptions> {
  if (!dir) return {};
  const file = path.join(dir, 'samey.config.json');
  if (!existsSync(file)) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${(err as Error).message}`);
  }
  const unknown = Object.keys(parsed).filter((k) => !FILE_KEYS.has(k) && k !== '$schema');
  if (unknown.length) throw new Error(`Unknown key${unknown.length > 1 ? 's' : ''} in samey.config.json: ${unknown.join(', ')}`);
  return parsed as Partial<AuditOptions>;
}
