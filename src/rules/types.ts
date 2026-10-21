import type { Category, CrawlResult, Evidence, Finding, RepoFacts, Severity } from '../types.js';

export interface RuleMeta {
  id: string;
  /** Bump when a rule's logic changes in a way that changes its findings. */
  version?: number;
  title: string;
  category: Category;
  description: string;
  /** Measured defect (true) or design observation that needs judgment (false). */
  verified: boolean;
  /** Relative weight w in p = s * c * w. Defaults to SCORING.defaultPenalty. */
  penalty?: number;
}

export interface RuleContext {
  crawl?: CrawlResult;
  repo?: RepoFacts;
}

export interface FindingInput {
  severity: Severity;
  confidence: number;
  description: string;
  recommendation: string;
  evidence: Evidence[];
  routes?: string[];
  title?: string;
}

export interface Rule extends RuleMeta {
  /** 'rendered' rules need a crawl, 'static' rules need a repository. */
  needs: 'rendered' | 'static';
  /**
   * For static rules that mirror a rendered rule: when the rendered rule fires, this rule's
   * source locations are attached to it as evidence instead of producing a second finding.
   */
  mergeInto?: string;
  run(ctx: RuleContext): FindingInput[];
}

/** Raw finding before normalization assigns id and fingerprint. */
export type DraftFinding = Omit<Finding, 'id' | 'fingerprint'>;

export function toDraft(rule: Rule, input: FindingInput, source: Finding['source']): DraftFinding {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version ?? 1,
    title: input.title ?? rule.title,
    category: rule.category,
    severity: input.severity,
    confidence: input.confidence,
    source,
    description: input.description,
    recommendation: input.recommendation,
    evidence: input.evidence,
    routes: input.routes,
    verified: rule.verified,
  };
}
