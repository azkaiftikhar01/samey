import type { Category, CategoryScore, Coverage, Finding, Severity } from './types.js';

/**
 * Versioned scoring configuration. The score measures detected quality problems, not the
 * probability of AI authorship: 0 means few slop indicators were found, 100 means many or
 * severe ones. Weights are starting hypotheses to be calibrated against human judgments.
 */
export const SCORING = {
  version: '3.0.0',
  // The brief's 10% 'technical' share is split into performance, SEO, and best practices.
  categoryWeights: { visual: 0.4, content: 0.2, functional: 0.15, accessibility: 0.15, performance: 0.05, seo: 0.03, practices: 0.02 } as Record<Category, number>,
  severityValues: { info: 0, low: 0.25, medium: 0.5, high: 0.75, critical: 1 } as Record<Severity, number>,
  /** Default rule penalty w. Rules may override it with `penalty`. */
  defaultPenalty: 40,
  /** P at which a category reaches ~63% (1 - 1/e). Larger = slower saturation. */
  saturation: 100,
} as const;

export const CATEGORY_LABELS: Record<Category, string> = {
  visual: 'Visual genericness',
  content: 'Content genericness',
  functional: 'Functional defects',
  accessibility: 'Accessibility and usability',
  performance: 'Performance',
  seo: 'SEO',
  practices: 'Best practices',
};

/** Categories that can only be measured by rendering the site. */
const RENDER_ONLY = new Set<Category>(['functional', 'accessibility', 'performance', 'seo', 'practices']);

/** p = s * c * w, rounded to 0.01 so the score is stable across platforms. */
export function findingPenalty(f: Pick<Finding, 'severity' | 'confidence' | 'advisory'>, rulePenalty: number = SCORING.defaultPenalty): number {
  if (f.advisory) return 0;
  return Math.round(SCORING.severityValues[f.severity] * f.confidence * rulePenalty * 100) / 100;
}

/** S = 100 (1 - e^(-P / saturation)), so many minor findings cannot exceed 100. */
export function saturate(P: number): number {
  return Math.round(100 * (1 - Math.exp(-Math.max(0, P) / SCORING.saturation)) * 10) / 10;
}

/**
 * Category score from the deduplicated findings, then the weighted average of the measured
 * categories. Categories that could not be measured are null and excluded, with the
 * remaining weights renormalized, so a static-only run is not reported as defect-free.
 */
export function scoreFindings(
  findings: Finding[],
  coverage: Pick<Coverage, 'rendered' | 'staticAnalysis'>,
  penalties: Record<string, number | undefined> = {},
): { score: number | null; categories: CategoryScore[] } {
  const categories: CategoryScore[] = (Object.keys(SCORING.categoryWeights) as Category[]).map((category) => {
    const measured = coverage.rendered || (!RENDER_ONLY.has(category) && coverage.staticAnalysis);
    const deductions = findings
      .filter((f) => f.category === category && !f.advisory)
      .map((f) => ({ findingId: f.id, ruleId: f.ruleId, penalty: findingPenalty(f, penalties[f.ruleId] ?? SCORING.defaultPenalty) }))
      .filter((d) => d.penalty > 0);
    const penalty = Math.round(deductions.reduce((s, d) => s + d.penalty, 0) * 100) / 100;
    return { category, weight: SCORING.categoryWeights[category], penalty, score: measured ? saturate(penalty) : null, deductions };
  });
  const measured = categories.filter((c) => c.score !== null);
  if (!measured.length) return { score: null, categories };
  const wsum = measured.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((measured.reduce((s, c) => s + (c.score as number) * c.weight, 0) / wsum) * 10) / 10;
  return { score, categories };
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** Fix-first order: verified defects, then severity, confidence, category weight, evidence count. */
export function prioritize(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      Number(!!a.advisory) - Number(!!b.advisory) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      Number(b.verified) - Number(a.verified) ||
      b.confidence - a.confidence ||
      SCORING.categoryWeights[b.category] - SCORING.categoryWeights[a.category] ||
      b.evidence.length - a.evidence.length ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}
