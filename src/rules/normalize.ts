import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Evidence, Finding } from '../types.js';
import type { DraftFinding } from './types.js';

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const MAX_EVIDENCE = 24;

/** Common credential shapes. Matches are replaced before anything reaches a report. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}\b/g, // Stripe, OpenAI, Anthropic style
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /((?:api[_-]?key|secret|token|password|passwd|auth|bearer)["']?\s*[:=]\s*["']?)[^\s"'`,;]{8,}/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m, prefix?: string) => (typeof prefix === 'string' && m.startsWith(prefix) ? `${prefix}[redacted]` : '[redacted]'));
  return out;
}

/** A source path is kept only if it is relative, inside the project, and in the scanned file set. */
export function safeSourcePath(file: string, known?: Set<string>): string | undefined {
  if (!file || path.isAbsolute(file) || /^[a-zA-Z]:/.test(file)) return undefined;
  const norm = path.posix.normalize(file.replace(/\\/g, '/'));
  if (norm.startsWith('../') || norm === '..' || norm.includes('\0')) return undefined;
  if (known && !known.has(norm)) return undefined;
  return norm;
}

function evidenceIdentity(e: Evidence): string {
  return [e.type, e.viewport ?? '', e.selector ?? '', e.file ?? '', e.line ?? '', e.excerpt ?? '', e.detail ?? ''].join('|');
}

/**
 * Identical evidence on several routes (the same footer link on every page) is one problem
 * in one shared component. Keep the first occurrence and list the other routes.
 */
export function collapseEvidence(evidence: Evidence[]): Evidence[] {
  const byKey = new Map<string, Evidence>();
  for (const e of evidence) {
    const key = evidenceIdentity(e);
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...e });
    else if (e.route && e.route !== prev.route) prev.alsoOn = [...new Set([...(prev.alsoOn ?? []), e.route])];
  }
  return [...byKey.values()];
}

/** Stable hash of rule identity and evidence identity, independent of routes and order. */
export function fingerprint(ruleId: string, evidence: Evidence[]): string {
  const keys = [...new Set(evidence.map(evidenceIdentity))].sort();
  return createHash('sha256').update(`${ruleId}\n${keys.join('\n')}`).digest('hex').slice(0, 16);
}

export function validateDraft(d: DraftFinding): void {
  if (typeof d.confidence !== 'number' || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1) {
    throw new RangeError(`Rule ${d.ruleId} produced confidence ${d.confidence}; it must be a number from 0 to 1.`);
  }
  if (!SEVERITIES.has(d.severity)) throw new RangeError(`Rule ${d.ruleId} produced unknown severity ${d.severity}.`);
  if (!d.ruleId || !d.description) throw new RangeError('Findings need a rule id and a description.');
}

function sanitizeEvidence(e: Evidence, knownFiles?: Set<string>): Evidence {
  const out: Evidence = { ...e };
  if (out.file !== undefined) {
    const safe = safeSourcePath(out.file, knownFiles);
    if (safe) out.file = safe;
    else {
      delete out.file;
      delete out.line;
    }
  }
  if (out.line !== undefined && (!Number.isInteger(out.line) || out.line < 1)) delete out.line;
  if (out.excerpt) out.excerpt = redact(out.excerpt).slice(0, 400);
  if (out.detail) out.detail = redact(out.detail).slice(0, 400);
  return out;
}

const SEV_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;

/**
 * Validates drafts, cleans evidence, assigns fingerprints and ids, and merges findings that
 * share a fingerprint (same rule, same evidence), keeping the higher severity and confidence.
 */
export function normalizeFindings(drafts: DraftFinding[], knownFiles?: Set<string>): Finding[] {
  const byFp = new Map<string, Finding>();
  for (const d of drafts) {
    validateDraft(d);
    const evidence = collapseEvidence(d.evidence.map((e) => sanitizeEvidence(e, knownFiles)));
    const fp = fingerprint(d.ruleId, evidence);
    const existing = byFp.get(fp);
    if (existing) {
      if (SEV_RANK[d.severity] > SEV_RANK[existing.severity]) existing.severity = d.severity;
      existing.confidence = Math.max(existing.confidence, d.confidence);
      existing.routes = [...new Set([...(existing.routes ?? []), ...(d.routes ?? [])])];
      existing.evidence = collapseEvidence([...existing.evidence, ...evidence]).slice(0, MAX_EVIDENCE);
      continue;
    }
    byFp.set(fp, {
      ...d,
      description: redact(d.description),
      evidence: evidence.slice(0, MAX_EVIDENCE),
      fingerprint: fp,
      id: `${d.ruleId}-${fp.slice(0, 8)}`,
    });
  }
  return [...byFp.values()];
}
