import path from 'node:path';
import pc from 'picocolors';
import { CATEGORY_LABELS } from '../score.js';
import type { AuditReport, Severity } from '../types.js';

const SEV_COLOR: Record<Severity, (s: string) => string> = {
  critical: (s) => pc.bold(pc.red(s)),
  high: pc.red,
  medium: pc.yellow,
  low: pc.dim,
  info: pc.dim,
};

export function summarize(report: AuditReport, files: { html?: string; json?: string; prompt?: string }): string {
  const out: string[] = [];
  const scored = report.findings.filter((f) => !f.advisory);
  const cov = report.coverage;
  out.push('');
  if (report.score === null) out.push(`  ${pc.bold('Slop score n/a')}  ${pc.dim('nothing could be measured')}`);
  else out.push(`  ${pc.bold(`Slop score ${report.score}`)}${pc.dim('/100, lower is better')}${cov.rendered ? '' : pc.dim('  (static analysis only)')}`);
  out.push('');
  for (const c of report.categories) {
    const label = CATEGORY_LABELS[c.category].padEnd(28);
    if (c.score === null) {
      out.push(pc.dim(`  ${label} not measured`));
      continue;
    }
    const filled = Math.round(c.score / 5);
    const bar = '█'.repeat(filled) + pc.dim('░'.repeat(20 - filled));
    out.push(`  ${label} ${bar} ${String(Math.round(c.score)).padStart(3)}`);
  }
  out.push('');
  out.push(
    pc.dim(
      `  ${cov.pagesAudited} page${cov.pagesAudited === 1 ? '' : 's'} rendered` +
        (report.repo ? `, ${report.repo.fileCount} source files scanned` : '') +
        (cov.routeLimitHit ? `, route limit reached` : '') +
        (cov.blockedRequests.length ? `, ${cov.blockedRequests.length} requests blocked by network policy` : ''),
    ),
  );
  if (cov.renderedNote) out.push(pc.yellow(`  ${cov.renderedNote}`));

  if (scored.length) {
    out.push('');
    out.push(pc.bold('  Fix first'));
    for (const f of scored.slice(0, 5)) {
      const where = f.evidence.find((e) => e.file) ?? f.evidence.find((e) => e.route);
      const loc = where?.file ? `${where.file}${where.line ? `:${where.line}` : ''}` : where?.route ?? '';
      out.push(`  ${SEV_COLOR[f.severity](f.severity.padEnd(8))} ${f.title}${f.verified ? '' : pc.dim(' (observation)')}${loc ? pc.dim(`  ${loc}`) : ''}`);
    }
    if (scored.length > 5) out.push(pc.dim(`  …and ${scored.length - 5} more in the report`));
  } else {
    out.push('');
    out.push('  No findings.');
  }

  out.push('');
  const rel = (p: string) => {
    const r = path.relative(process.cwd(), p);
    return !r || r.startsWith('..') ? p : r;
  };
  if (files.html) out.push(`  Report  ${pc.underline(rel(files.html))}`);
  if (files.json) out.push(`  JSON    ${rel(files.json)}`);
  if (files.prompt) {
    out.push(`  Prompt  ${rel(files.prompt)}`);
    // Spell out the exact command, since `samey prompt` looks in <path>/.samey unless told otherwise.
    const dir = path.dirname(files.prompt);
    const base = report.target.path ?? process.cwd();
    const arg = dir === path.join(base, '.samey') ? (rel(base) === base ? (report.target.path ? ` ${base}` : '') : rel(base) ? ` ${rel(base)}` : '') : ` --out ${rel(dir)}`;
    out.push(pc.dim(`          Paste it into Claude Code, Cursor or Codex, or copy it: npx samey prompt${arg}${process.platform === 'darwin' ? ' | pbcopy' : ''}`));
  }
  out.push('');
  return out.join('\n');
}
