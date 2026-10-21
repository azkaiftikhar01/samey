import type { AxeViolation, Evidence, PageFacts, Severity, ViewportName } from '../types.js';
import { plural, uniqueRoutes } from './helpers.js';
import type { FindingInput, Rule } from './types.js';

const IMPACT: Record<string, Severity> = { critical: 'high', serious: 'medium', moderate: 'low', minor: 'low' };

/** True when axe ran on this page and viewport, so the hand-written equivalents should stand down. */
export function axeRan(page: PageFacts, vp: ViewportName): boolean {
  return Array.isArray(page[vp]?.axe);
}

export const axeRule: Rule = {
  id: 'axe',
  version: 1,
  title: 'Accessibility (axe-core)',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  description: 'WCAG 2.0 to 2.2 A and AA checks and best practices from axe-core: contrast, names, labels, ARIA, landmarks, target size, and more.',
  run({ crawl }) {
    const byRule = new Map<string, { v: AxeViolation; ev: Evidence[]; total: number }>();
    for (const page of crawl?.pages ?? []) {
      for (const vp of ['desktop', 'mobile'] as const) {
        for (const v of page[vp]?.axe ?? []) {
          let entry = byRule.get(v.id);
          if (!entry) byRule.set(v.id, (entry = { v, ev: [], total: 0 }));
          entry.total += v.nodeCount;
          for (const n of v.nodes) {
            entry.ev.push({
              type: 'dom',
              route: page.path,
              viewport: vp,
              selector: n.target,
              rect: n.rect,
              excerpt: n.html,
              detail: n.summary.replace(/^Fix (?:any|all) of the following:\s*/i, '').split('\n')[0],
            });
          }
        }
      }
    }
    const out: FindingInput[] = [];
    for (const [id, { v, ev, total }] of byRule) {
      const best = v.tags.includes('best-practice') && !v.tags.some((t) => /^wcag/.test(t));
      const wcag = v.tags.filter((t) => /^wcag\d{3,}$/.test(t)).map((t) => t.replace(/^wcag(\d)(\d)(\d+)$/, '$1.$2.$3'));
      out.push({
        ruleId: `axe/${id}`,
        title: v.help,
        // Best-practice rules are useful but not WCAG failures, so they weigh one step less.
        severity: best && IMPACT[v.impact] === 'high' ? 'medium' : best ? 'low' : (IMPACT[v.impact] ?? 'low'),
        confidence: 0.9,
        description: `${v.description.replace(/\.?\s*$/, '.')} axe found ${plural(total, 'element')} on ${plural(uniqueRoutes(ev).length, 'page')}${wcag.length ? ` (WCAG ${wcag.join(', ')})` : best ? ' (best practice)' : ''}.`,
        recommendation: `${v.help}. The detail on each item says exactly what to change. Reference: ${v.helpUrl}`,
        evidence: ev,
        routes: uniqueRoutes(ev),
      });
    }
    return out;
  },
};

export const accessibilityRules: Rule[] = [axeRule];
