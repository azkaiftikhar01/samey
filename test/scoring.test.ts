import { describe, expect, it } from 'vitest';
import { collapseEvidence, fingerprint, normalizeFindings, redact, safeSourcePath, validateDraft } from '../src/rules/normalize.js';
import type { DraftFinding } from '../src/rules/types.js';
import { findingPenalty, prioritize, saturate, SCORING, scoreFindings } from '../src/score.js';
import type { Finding } from '../src/types.js';

const draft = (over: Partial<DraftFinding> = {}): DraftFinding => ({
  ruleId: 'r', ruleVersion: 1, title: 't', category: 'functional', severity: 'high', confidence: 0.9, source: 'rendered',
  description: 'd', recommendation: 'fix', evidence: [{ type: 'dom', route: '/', selector: 'a' }], verified: true, ...over,
});
const finding = (over: Partial<DraftFinding> = {}): Finding => normalizeFindings([draft(over)])[0];

describe('scoring formula', () => {
  it('p = s * c * w', () => {
    expect(findingPenalty({ severity: 'high', confidence: 0.9 }, 40)).toBe(27);
    expect(findingPenalty({ severity: 'critical', confidence: 1 }, 40)).toBe(40);
    expect(findingPenalty({ severity: 'info', confidence: 1 }, 40)).toBe(0);
    expect(findingPenalty({ severity: 'critical', confidence: 1, advisory: true }, 40)).toBe(0);
  });

  it('saturates: 0 at P=0, 63.2 at P=saturation, never reaches 100', () => {
    expect(saturate(0)).toBe(0);
    expect(saturate(-5)).toBe(0);
    expect(saturate(SCORING.saturation)).toBe(63.2);
    expect(saturate(10_000)).toBeLessThanOrEqual(100);
    expect(saturate(50)).toBeLessThan(saturate(51));
  });

  it('weights sum to 1', () => {
    expect(Object.values(SCORING.categoryWeights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('scores 0 for a clean measured site and null when nothing was measured', () => {
    expect(scoreFindings([], { rendered: true, staticAnalysis: true }).score).toBe(0);
    expect(scoreFindings([], { rendered: false, staticAnalysis: false }).score).toBeNull();
  });

  it('excludes render-only categories from a static run and renormalizes weights', () => {
    const f = finding({ category: 'visual', severity: 'critical', confidence: 1 });
    const { score, categories } = scoreFindings([f], { rendered: false, staticAnalysis: true });
    expect(categories.find((c) => c.category === 'functional')!.score).toBeNull();
    const visual = categories.find((c) => c.category === 'visual')!.score!;
    expect(score).toBeCloseTo((visual * 0.4) / 0.6, 1);
  });

  it('applies per-rule penalty overrides and ignores advisory findings', () => {
    const f = finding();
    const m = finding({ ruleId: 'model-critique', advisory: true, severity: 'critical' });
    const base = scoreFindings([f, m], { rendered: true, staticAnalysis: false });
    const heavy = scoreFindings([f], { rendered: true, staticAnalysis: false }, { r: 80 });
    expect(base.categories.find((c) => c.category === 'functional')!.penalty).toBe(27);
    expect(heavy.categories.find((c) => c.category === 'functional')!.penalty).toBe(54);
  });

  it('is deterministic for a fixed set of findings', () => {
    const fs = [finding(), finding({ ruleId: 'x', category: 'visual', severity: 'low', confidence: 0.6, evidence: [{ type: 'metric', detail: 'm' }] })];
    const a = scoreFindings(fs, { rendered: true, staticAnalysis: true });
    const b = scoreFindings([...fs].reverse(), { rendered: true, staticAnalysis: true });
    expect(a).toEqual({ ...b, categories: a.categories.map((c, i) => ({ ...b.categories[i], deductions: c.deductions })) });
    expect(prioritize(fs).map((f) => f.id)).toEqual(prioritize([...fs].reverse()).map((f) => f.id));
  });
});

describe('normalization', () => {
  it('rejects confidence outside 0..1 and unknown severities', () => {
    expect(() => validateDraft(draft({ confidence: 1.2 }))).toThrow(RangeError);
    expect(() => validateDraft(draft({ confidence: -0.1 }))).toThrow(RangeError);
    expect(() => validateDraft(draft({ confidence: NaN }))).toThrow(RangeError);
    expect(() => validateDraft(draft({ severity: 'huge' as never }))).toThrow(RangeError);
    expect(() => validateDraft(draft({ confidence: 0 }))).not.toThrow();
  });

  it('fingerprints ignore evidence order and routes', () => {
    const a = [{ type: 'dom' as const, route: '/', selector: 'footer a' }, { type: 'dom' as const, route: '/', selector: 'nav a' }];
    const b = [{ type: 'dom' as const, route: '/about', selector: 'nav a' }, { type: 'dom' as const, route: '/x', selector: 'footer a' }];
    expect(fingerprint('r', a)).toBe(fingerprint('r', b));
    expect(fingerprint('r', a)).not.toBe(fingerprint('other', a));
  });

  it('collapses a shared component seen on several routes into one evidence item', () => {
    const ev = collapseEvidence([
      { type: 'dom', route: '/', selector: 'footer a', excerpt: 'Privacy' },
      { type: 'dom', route: '/about', selector: 'footer a', excerpt: 'Privacy' },
      { type: 'dom', route: '/pricing', selector: 'footer a', excerpt: 'Privacy' },
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0].alsoOn).toEqual(['/about', '/pricing']);
  });

  it('merges duplicate findings and penalizes them once', () => {
    const fs = normalizeFindings([
      draft({ routes: ['/'], evidence: [{ type: 'dom', route: '/', selector: 'h1' }] }),
      draft({ routes: ['/about'], severity: 'critical', evidence: [{ type: 'dom', route: '/about', selector: 'h1' }] }),
    ]);
    expect(fs).toHaveLength(1);
    expect(fs[0].severity).toBe('critical');
    expect(fs[0].routes).toEqual(['/', '/about']);
    expect(fs[0].id).toBe(`r-${fs[0].fingerprint.slice(0, 8)}`);
  });

  it('keeps only safe, known source paths', () => {
    const known = new Set(['src/a.tsx']);
    expect(safeSourcePath('src/a.tsx', known)).toBe('src/a.tsx');
    expect(safeSourcePath('./src/a.tsx', known)).toBe('src/a.tsx');
    expect(safeSourcePath('../etc/passwd')).toBeUndefined();
    expect(safeSourcePath('src/../../x')).toBeUndefined();
    expect(safeSourcePath('/etc/passwd')).toBeUndefined();
    expect(safeSourcePath('C:\\\\x')).toBeUndefined();
    expect(safeSourcePath('src/b.tsx', known)).toBeUndefined();
    const [f] = normalizeFindings([draft({ evidence: [{ type: 'source', file: '../secret', line: 3 }] })], known);
    expect(f.evidence[0].file).toBeUndefined();
    expect(f.evidence[0].line).toBeUndefined();
  });

  it('redacts credentials from excerpts', () => {
    expect(redact('const key = "sk-proj-abcdefghijklmnopqrstuv"')).not.toContain('abcdefghij');
    expect(redact('apiKey: "AKIAABCDEFGHIJKLMNOP"')).toContain('[redacted]');
    expect(redact('token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).not.toContain('ghp_aaaa');
    expect(redact('Unlock the power of seamless collaboration')).toBe('Unlock the power of seamless collaboration');
    const [f] = normalizeFindings([draft({ evidence: [{ type: 'source', excerpt: 'password: "hunter2hunter2"' }] })]);
    expect(f.evidence[0].excerpt).toBe('password: "[redacted]"');
  });
});
