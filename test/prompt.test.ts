import { describe, expect, it } from 'vitest';
import { fullPrompt } from '../src/report/prompt.js';
import { normalizeFindings } from '../src/rules/normalize.js';
import type { DraftFinding } from '../src/rules/types.js';
import type { AuditReport } from '../src/types.js';

const draft = (over: Partial<DraftFinding>): DraftFinding => ({
  ruleId: 'r', ruleVersion: 1, title: 'Title', category: 'functional', severity: 'high', confidence: 0.9, source: 'rendered',
  description: 'What was seen.', recommendation: 'Do this.', evidence: [{ type: 'dom', route: '/', selector: 'nav a', file: 'index.html', line: 12 }], verified: true, ...over,
});

const report = (drafts: DraftFinding[], target: AuditReport['target'] = { path: '/p' }): AuditReport =>
  ({ findings: normalizeFindings(drafts), target, score: 41.5, repo: { frameworks: ['Next.js'], fileCount: 1, truncated: false } }) as unknown as AuditReport;

describe('fix prompt', () => {
  const r = report([
    draft({ ruleId: 'stock-copy', title: 'Stock copy', category: 'content', severity: 'medium', verified: false, evidence: [{ type: 'dom', route: '/', excerpt: 'Unlock the power' }] }),
    draft({ ruleId: 'placeholder-links', title: 'Dead links' }),
    draft({ ruleId: 'info-only', severity: 'info', evidence: [{ type: 'metric', detail: 'x' }] }),
    draft({ ruleId: 'model-critique', advisory: true, source: 'model', evidence: [{ type: 'screenshot', route: '/' }] }),
  ]);
  const text = fullPrompt(r)!;

  it('puts measured defects before design observations, with evidence and the fix', () => {
    expect(text.indexOf('## Defects')).toBeLessThan(text.indexOf('## Design observations'));
    expect(text.indexOf('[placeholder-links]')).toBeLessThan(text.indexOf('[stock-copy]'));
    expect(text).toContain('index.html:12');
    expect(text).toContain('selector `nav a`');
    expect(text).toContain('Fix: Do this.');
    expect(text).toContain('Stack: Next.js');
  });

  it('leaves out info-level and advisory model findings', () => {
    expect(text).not.toContain('[info-only]');
    expect(text).not.toContain('[model-critique]');
  });

  it('can include defects only, and returns null when nothing is actionable', () => {
    const only = fullPrompt(r, { onlyDefects: true })!;
    expect(only).toContain('[placeholder-links]');
    expect(only).not.toContain('[stock-copy]');
    expect(fullPrompt(report([draft({ severity: 'info' })]))).toBeNull();
  });

  it('ends with the right command to verify', () => {
    expect(text.trim().endsWith('run `npx samey audit .` and confirm these findings are gone.')).toBe(true);
    expect(fullPrompt(report([draft({})], { url: 'https://x.dev/' }))).toContain('npx samey audit --url https://x.dev/');
  });
});
