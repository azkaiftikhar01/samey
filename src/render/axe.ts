import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';
import type { AxeViolation } from '../types.js';
import { runInPage } from './extract.js';

const require = createRequire(import.meta.url);

/** WCAG 2.0 to 2.2 A and AA, plus axe's best-practice rules. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const MAX_NODES = 15;

let source: string | undefined;
export function axeVersion(): string {
  try {
    return (require('axe-core/package.json') as { version: string }).version;
  } catch {
    return 'unavailable';
  }
}

function axeSource(): string {
  source ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  return source;
}

/**
 * Runs axe-core in the page and returns its violations with element positions. axe is
 * injected with page.evaluate, so it needs no network access and is not blocked by the
 * page's Content-Security-Policy. `incomplete` results (needs review) are not reported.
 */
export async function runAxe(page: Page, opts: { rules?: string[]; timeoutMs: number }): Promise<AxeViolation[]> {
  await page.evaluate(`${axeSource()};undefined`);
  const run = runInPage(
    page,
    async ({ tags, rules, maxNodes }: { tags: string[]; rules?: string[]; maxNodes: number }) => {
      const w = window as unknown as { axe: { run: (ctx: unknown, o: unknown) => Promise<{ violations: any[] }> } };
      const options = rules
        ? { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] }
        : { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] };
      const res = await w.axe.run(document, options);
      return res.violations.map((v: any) => ({
        id: v.id as string,
        impact: (v.impact ?? 'minor') as string,
        help: v.help as string,
        description: v.description as string,
        helpUrl: v.helpUrl as string,
        tags: v.tags as string[],
        nodeCount: v.nodes.length as number,
        nodes: v.nodes.slice(0, maxNodes).map((n: any) => {
          const target = (n.target as unknown[]).map((t) => (Array.isArray(t) ? t.join(' >>> ') : String(t))).join(' >>> ');
          let rect;
          try {
            const el = document.querySelector(String(n.target[n.target.length - 1]));
            if (el) {
              const r = el.getBoundingClientRect();
              rect = { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
            }
          } catch {
            /* selectors inside shadow roots or frames are not resolvable from the top document */
          }
          return { target, html: String(n.html).slice(0, 300), summary: String(n.failureSummary ?? '').slice(0, 400), rect };
        }),
      }));
    },
    { tags: AXE_TAGS, rules: opts.rules, maxNodes: MAX_NODES },
  ) as unknown as Promise<AxeViolation[]>;
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`axe timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs).unref());
  return (await Promise.race([run, timeout])) as AxeViolation[];
}
