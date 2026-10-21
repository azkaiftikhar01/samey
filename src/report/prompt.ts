import type { AuditReport, Finding } from '../types.js';

/** Shared by the HTML report's copy buttons, fix-prompt.md, and `samey prompt`. */
export const PROMPT_HEADER =
  'Fix the following UI issues reported by samey. Make focused changes, keep unrelated code as is, and re-run samey afterwards to verify.\n\n';

/** One finding as plain text an AI coding agent can act on. */
export function fixPrompt(f: Finding): string {
  const ev = f.evidence
    .slice(0, 10)
    .map((e) => {
      const bits = [
        e.route && `route ${e.route}${e.viewport ? ` (${e.viewport})` : ''}${e.alsoOn?.length ? `, also on ${e.alsoOn.join(', ')}` : ''}`,
        e.file && `${e.file}${e.line ? `:${e.line}` : ''}`,
        e.selector && `selector \`${e.selector}\``,
        e.excerpt && `"${e.excerpt}"`,
        e.detail,
      ].filter(Boolean);
      return `- ${bits.join(', ')}`;
    })
    .join('\n');
  return `[${f.ruleId}] ${f.title}${f.verified ? '' : ' (design observation, use judgment)'}\n${f.description}\n${ev ? `Evidence:\n${ev}\n` : ''}Fix: ${f.recommendation}`;
}

function rerunCommand(report: AuditReport): string {
  if (report.target.url && report.target.path) return `npx samey audit . --url ${report.target.url}`;
  if (report.target.url) return `npx samey audit --url ${report.target.url}`;
  return 'npx samey audit .';
}

/**
 * The whole audit as one prompt: measured defects first, then design observations the agent
 * should weigh rather than apply blindly. Info-level and advisory model findings are left out.
 */
export function fullPrompt(report: AuditReport, opts: { onlyDefects?: boolean } = {}): string | null {
  const actionable = report.findings.filter((f) => !f.advisory && f.severity !== 'info');
  const defects = actionable.filter((f) => f.verified);
  const observations = opts.onlyDefects ? [] : actionable.filter((f) => !f.verified);
  if (!defects.length && !observations.length) return null;

  const context: string[] = [];
  if (report.target.url) context.push(`Site: ${report.target.url}`);
  if (report.repo?.frameworks.length) context.push(`Stack: ${report.repo.frameworks.join(', ')}`);
  if (report.score !== null) context.push(`Current slop score: ${report.score}/100 (lower is better)`);

  const out: string[] = [PROMPT_HEADER.trimEnd(), ''];
  if (context.length) out.push(context.join('\n'), '');
  out.push(
    'Work through the list in order. Each item names the page, the CSS selector, and the source file and line when samey could trace it. ' +
      'Where a fix needs content only a person can provide (real testimonials, real numbers, a brand colour), ask instead of inventing it.',
    '',
  );
  let n = 0;
  if (defects.length) {
    out.push('## Defects (measured, fix these)', '');
    for (const f of defects) out.push(`${++n}. ${fixPrompt(f)}`, '');
  }
  if (observations.length) {
    out.push('## Design observations (heuristics, use judgment)', '');
    for (const f of observations) out.push(`${++n}. ${fixPrompt(f)}`, '');
  }
  out.push(`When you are done, run \`${rerunCommand(report)}\` and confirm these findings are gone.`);
  return out.join('\n') + '\n';
}
