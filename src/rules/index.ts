import { locateText } from '../static/scan.js';
import type { Finding } from '../types.js';
import { contentRules } from './content.js';
import { functionalRules } from './functional.js';
import { normalizeFindings, validateDraft } from './normalize.js';
import { staticRules } from './static.js';
import { toDraft, type DraftFinding, type Rule, type RuleContext } from './types.js';
import { visualRules } from './visual.js';

export const allRules: Rule[] = [...visualRules, ...contentRules, ...functionalRules, ...staticRules];

export const ruleVersions = (): Record<string, number> => Object.fromEntries(allRules.map((r) => [r.id, r.version ?? 1]));
export const rulePenalties = (): Record<string, number | undefined> => Object.fromEntries(allRules.map((r) => [r.id, r.penalty]));

/** Rendered rules whose element evidence carries visible text worth tracing back to source. */
const TRACEABLE = new Set(['stock-copy', 'placeholder-content', 'duplicate-copy', 'unverified-claims', 'emoji-icons', 'generic-link-text']);

export interface RuleRun {
  findings: Finding[];
  errors: { ruleId: string; message: string }[];
}

export function runRules(ctx: RuleContext, ignore: string[] = []): RuleRun {
  const drafts: DraftFinding[] = [];
  const errors: RuleRun['errors'] = [];
  const ignored = new Set(ignore);
  const deferred: { rule: Rule; draft: DraftFinding }[] = [];

  for (const rule of allRules) {
    if (ignored.has(rule.id) || (rule.mergeInto && ignored.has(rule.mergeInto))) continue;
    if (rule.needs === 'rendered' && !ctx.crawl) continue;
    if (rule.needs === 'static' && !ctx.repo) continue;
    let inputs;
    try {
      inputs = rule.run(ctx);
    } catch (err) {
      errors.push({ ruleId: rule.id, message: (err as Error).message });
      continue;
    }
    for (const input of inputs) {
      const d = toDraft(rule, input, rule.needs === 'static' ? 'static' : 'rendered');
      if (rule.mergeInto) deferred.push({ rule, draft: d });
      else drafts.push(d);
    }
  }

  // Attach source locations to rendered text findings when the exact text is found in the repo.
  if (ctx.repo) {
    for (const d of drafts) {
      if (!TRACEABLE.has(d.ruleId)) continue;
      for (const e of d.evidence) {
        if (!e.excerpt || e.file) continue;
        const text = e.excerpt.replace(/^…/, '').replace(/…$/, '');
        const loc = locateText(ctx.repo.files, text, 1, e.route)[0];
        if (loc) {
          e.file = loc.file;
          e.line = loc.line;
        }
      }
    }
  }

  // Fold static mirrors into their rendered counterpart when it fired; otherwise keep them standalone.
  for (const { rule, draft } of deferred) {
    const target = drafts.find((f) => f.ruleId === rule.mergeInto);
    if (target) {
      const have = new Set(target.evidence.filter((e) => e.file).map((e) => `${e.file}:${e.line}`));
      const extra = draft.evidence.filter((e) => !have.has(`${e.file}:${e.line}`)).slice(0, 8);
      target.evidence.push(...extra);
      if (extra.length) target.description += ` Source locations: ${draft.evidence.length} matching line${draft.evidence.length === 1 ? '' : 's'} in the repository.`;
    } else {
      drafts.push(draft);
    }
  }

  // Screenshot references for element evidence, so each item points at an image of where it is.
  if (ctx.crawl) {
    const shots = new Map<string, string>();
    for (const p of ctx.crawl.pages)
      for (const vp of ['desktop', 'mobile'] as const) {
        const file = p[vp]?.screenshot;
        if (file) shots.set(`${p.path}|${vp}`, `shots/${file}`);
      }
    for (const d of drafts)
      for (const e of d.evidence) {
        if (e.route && e.viewport && !e.screenshotPath) e.screenshotPath = shots.get(`${e.route}|${e.viewport}`);
      }
  }

  // A rule bug (say, confidence out of range) drops that one finding, not the whole audit.
  const valid = drafts.filter((d) => {
    try {
      validateDraft(d);
      return true;
    } catch (err) {
      errors.push({ ruleId: d.ruleId, message: (err as Error).message });
      return false;
    }
  });
  const findings: Finding[] = normalizeFindings(valid, ctx.repo ? new Set(ctx.repo.files.map((f) => f.path)) : undefined);
  return { findings, errors };
}
