import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DraftFinding } from '../rules/types.js';
import type { CrawlResult } from '../types.js';

/**
 * Optional visual critique by a local, open-weight vision model served by Ollama.
 * Only loopback endpoints are accepted, so screenshots never leave the machine.
 * Model output is advisory: it is shown in the report but never changes the score.
 */
export interface ModelOptions {
  model: string;
  endpoint: string;
  timeoutMs: number;
  maxPages: number;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertLoopback(endpoint: string): URL {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new Error(`Invalid model endpoint: ${endpoint}`);
  }
  if (!LOOPBACK.has(u.hostname)) {
    throw new Error(`Model endpoint must be on this machine (localhost/127.0.0.1/::1). Refusing to send screenshots to ${u.hostname}.`);
  }
  return u;
}

const PROMPT = `You are reviewing a screenshot of a web page for design quality. Focus only on what is visible.
List up to 5 specific, observable problems that make the page look generic, template-like, or unfinished:
for example weak visual hierarchy, stock gradients, interchangeable hero layout, decorative effects without purpose,
cramped or inconsistent spacing, unclear primary action. Do not guess who made the site. Do not praise.
Respond with JSON only: {"findings":[{"title":"short title","observation":"what you see and where","recommendation":"concrete fix"}]}`;

interface ModelFinding {
  title: string;
  observation: string;
  recommendation: string;
}

export function parseModelOutput(raw: string): ModelFinding[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { findings?: unknown };
    if (!Array.isArray(parsed.findings)) return [];
    return parsed.findings
      .filter((f): f is ModelFinding => !!f && typeof f === 'object' && typeof (f as ModelFinding).title === 'string' && typeof (f as ModelFinding).observation === 'string')
      .map((f) => ({ title: f.title.slice(0, 100), observation: f.observation.slice(0, 500), recommendation: String(f.recommendation ?? '').slice(0, 400) }))
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function checkModel(opts: ModelOptions): Promise<{ ok: boolean; note?: string }> {
  const base = assertLoopback(opts.endpoint);
  try {
    const res = await fetch(new URL('/api/tags', base), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, note: `endpoint returned HTTP ${res.status}` };
    const body = (await res.json()) as { models?: { name: string }[] };
    const names = (body.models ?? []).map((m) => m.name);
    if (!names.some((n) => n === opts.model || n.split(':')[0] === opts.model)) {
      return { ok: false, note: `model "${opts.model}" is not pulled (available: ${names.join(', ') || 'none'}). Run: ollama pull ${opts.model}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, note: `no local model server at ${opts.endpoint}` };
  }
}

export async function critiqueScreens(crawl: CrawlResult, shotsDir: string, opts: ModelOptions): Promise<DraftFinding[]> {
  const base = assertLoopback(opts.endpoint);
  const findings: DraftFinding[] = [];
  const pages = crawl.pages.filter((p) => p.desktop?.screenshot).slice(0, opts.maxPages);
  for (const p of pages) {
    const img = readFileSync(path.join(shotsDir, p.desktop!.screenshot!)).toString('base64');
    const res = await fetch(new URL('/api/generate', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: opts.model, prompt: PROMPT, images: [img], stream: false, format: 'json', options: { temperature: 0.2 } }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as { response?: string };
    for (const mf of parseModelOutput(body.response ?? '')) {
      findings.push({
        ruleId: 'model-critique',
        ruleVersion: 1,
        verified: false,
        title: mf.title,
        category: 'visual',
        severity: 'info',
        confidence: 0.3,
        source: 'model',
        advisory: true,
        description: mf.observation,
        recommendation: mf.recommendation || 'Review the screenshot and decide whether this applies.',
        evidence: [{ type: 'screenshot', route: p.path, viewport: 'desktop', screenshotPath: `shots/${p.desktop!.screenshot}`, detail: `${opts.model} reviewing the desktop screenshot` }],
        routes: [p.path],
      });
    }
  }
  return findings;
}
