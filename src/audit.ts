import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkModel, critiqueScreens } from './ai/local-model.js';
import type { AuditOptions } from './config.js';
import { BrowserMissingError, crawl, launchBrowser, VIEWPORTS } from './render/crawl.js';
import { serveStatic, startDevServer, type RunningServer } from './render/server.js';
import { renderHtml } from './report/html.js';
import { rulePenalties, ruleVersions, runRules } from './rules/index.js';
import { normalizeFindings } from './rules/normalize.js';
import { CATEGORY_LABELS, prioritize, SCORING, scoreFindings } from './score.js';
import { BlockedError, displayUrl, DEV_POLICY, REMOTE_POLICY, resolveTarget, type NetworkPolicy } from './security/net-policy.js';
import { scanRepo } from './static/scan.js';
import type { AuditReport, Coverage, CrawlResult, Finding, RepoFacts } from './types.js';

export function toolVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
}

export interface AuditResult {
  report: AuditReport;
  files: { html?: string; json?: string };
  ruleErrors: { ruleId: string; message: string }[];
}

export class AuditError extends Error {}

export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const began = Date.now();
  const log = opts.onProgress ?? (() => undefined);
  if (!opts.path && !opts.url) throw new AuditError('Nothing to audit: pass a project path, --url, or both.');

  // Validate the URL before doing any other work. Non-public addresses need explicit --dev.
  const urlPolicy: NetworkPolicy = opts.policyOverride ?? (opts.dev ? DEV_POLICY : REMOTE_POLICY);
  if (opts.url) {
    try {
      await resolveTarget(opts.url, urlPolicy);
    } catch (err) {
      if (!(err instanceof BlockedError)) throw err;
      const local = /loopback|private/.test(err.message);
      throw new AuditError(
        local && !opts.dev
          ? `${err.message}. To audit a local or private development server, pass --dev.`
          : `Refusing to audit ${opts.url}: ${err.message}.`,
      );
    }
  }

  const outDir = path.resolve(opts.outDir);
  const shotsDir = path.join(outDir, 'shots');
  mkdirSync(outDir, { recursive: true });
  // Clear screenshots from a previous run so the report never shows stale images.
  try {
    for (const f of readdirSync(shotsDir)) if (f.endsWith('.jpg')) rmSync(path.join(shotsDir, f));
  } catch {
    /* no previous shots */
  }

  const coverage: Coverage = {
    staticAnalysis: false,
    rendered: false,
    renderAttempted: false,
    pagesAudited: 0,
    pagesFailed: 0,
    routeLimitHit: false,
    skipped: [],
    interactions: false,
    blockedRequests: [],
    networkBudgetExceeded: false,
    model: { enabled: false },
    limitations: [],
  };

  let repo: RepoFacts | undefined;
  if (opts.path) {
    log(`Scanning ${path.relative(process.cwd(), opts.path) || '.'}`);
    repo = scanRepo(opts.path);
    coverage.staticAnalysis = true;
    log(`Found ${repo.fileCount} source files${repo.frameworks.length ? ` (${repo.frameworks.join(', ')})` : ''}${repo.truncated ? ', file limit reached' : ''}`);
  }

  let crawlResult: CrawlResult | undefined;
  let server: RunningServer | undefined;
  try {
    let target = opts.url;
    if (!target && !opts.staticOnly && repo) {
      if (opts.serve) {
        log(`Starting dev server: ${opts.serve}`);
        server = await startDevServer(opts.serve, repo.root, opts.port, opts.serverTimeoutMs);
        target = server.url;
      } else if (repo.staticRoot) {
        server = await serveStatic(repo.staticRoot);
        target = server.url;
        log(`Serving ${path.relative(process.cwd(), repo.staticRoot) || '.'} at ${target}`);
      } else {
        coverage.renderedNote =
          'No URL was given, the project has no static build to serve, and --serve was not passed, so rendered checks did not run. ' +
          "Pass --url http://localhost:3000 for a running server, or --serve 'npm run dev' to let samey start it.";
      }
    }
    if (opts.staticOnly) coverage.renderedNote = 'Rendered checks were disabled with --static-only.';

    if (target) {
      // A server samey started is on loopback; it does not need access to the rest of the private network.
      const policy: NetworkPolicy = opts.policyOverride ?? (server ? { allowLoopback: true, allowPrivate: false } : urlPolicy);
      const browser = await launchBrowser(policy).catch((err) => {
        if (err instanceof BrowserMissingError) {
          coverage.renderedNote = err.message;
          log(err.message);
          return undefined;
        }
        throw err;
      });
      if (browser) {
        try {
          const isLocalProject = !!server || !!(repo && opts.url && opts.dev);
          crawlResult = await crawl(browser, {
            startUrl: target,
            maxRoutes: opts.maxRoutes,
            navTimeoutMs: opts.navTimeoutMs,
            pageTimeoutMs: opts.pageTimeoutMs,
            seeds: [...opts.routes, ...(isLocalProject && repo ? repo.routeHints : [])],
            shotsDir: opts.screenshots ? shotsDir : undefined,
            interact: opts.interact,
            respectRobots: opts.respectRobots && !isLocalProject,
            policy,
            onProgress: log,
          });
        } finally {
          await browser.close();
        }
        coverage.renderAttempted = true;
        coverage.rendered = crawlResult.pages.some((p) => p.desktop);
        coverage.pagesAudited = crawlResult.pages.length;
        coverage.pagesFailed = crawlResult.pages.filter((p) => !p.desktop).length;
        coverage.routeLimitHit = crawlResult.limitHit;
        coverage.skipped = crawlResult.skipped;
        coverage.interactions = opts.interact;
        coverage.blockedRequests = crawlResult.network.blocked.slice(0, 20);
        coverage.networkBudgetExceeded = crawlResult.network.budgetExceeded;
        if (!coverage.rendered) {
          const why = crawlResult.pages.find((p) => p.error)?.error ?? (crawlResult.pages[0]?.status ? `HTTP ${crawlResult.pages[0].status}` : 'unknown error');
          coverage.renderedNote = `No page under ${server ? 'the local server' : target} could be rendered (${why}).`;
        }
      }
    }
  } finally {
    await server?.close();
  }

  log('Running rules');
  const { findings, errors } = runRules({ crawl: crawlResult, repo }, opts.ignoreRules);

  let modelFindings: Finding[] = [];
  if (opts.ai && opts.model && crawlResult && opts.screenshots) {
    const mopts = { model: opts.model, endpoint: opts.modelEndpoint, timeoutMs: opts.modelTimeoutMs, maxPages: 3 };
    const check = await checkModel(mopts).catch((e: Error) => ({ ok: false, note: e.message }));
    coverage.model = { enabled: check.ok, name: opts.model, note: check.note };
    if (check.ok) {
      log(`Asking local model ${opts.model} for a visual critique`);
      const drafts = await critiqueScreens(crawlResult, shotsDir, mopts).catch((e: Error) => {
        coverage.model.note = `model run failed: ${e.message}`;
        return [];
      });
      modelFindings = normalizeFindings(drafts);
    }
  } else {
    coverage.model = {
      enabled: false,
      note: !opts.ai ? 'disabled with --no-ai' : !opts.model ? 'no local model configured (optional; see --model)' : 'needs rendered screenshots',
    };
  }

  const all = [...findings, ...modelFindings];
  const { score, categories } = scoreFindings(all, coverage, rulePenalties());
  coverage.limitations = limitations(coverage, categories.filter((c) => c.score === null).map((c) => CATEGORY_LABELS[c.category]));
  const pages = crawlResult?.pages ?? [];
  const projectKey = repo?.root ?? (opts.url ? new URL(opts.url).origin : 'unknown');
  const report: AuditReport = {
    schemaVersion: 1,
    scanId: randomUUID(),
    tool: { name: 'samey', version: toolVersion() },
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - began,
    project: { id: createHash('sha256').update(projectKey).digest('hex').slice(0, 12), name: repo?.name ?? (opts.url ? new URL(opts.url).hostname : undefined) },
    // The ephemeral 127.0.0.1 address of a server samey started itself is not useful to report.
    target: { path: repo?.root, url: opts.url ? displayUrl(opts.url) : undefined },
    score,
    categories,
    findings: prioritize(all),
    coverage,
    versions: { scoring: SCORING.version, rules: ruleVersions(), model: coverage.model.enabled ? coverage.model.name : undefined },
    viewports: crawlResult ? (['desktop', 'mobile'] as const).map((name) => ({ name, width: VIEWPORTS[name].width, height: VIEWPORTS[name].height })) : [],
    failedRoutes: pages
      .filter((p) => !p.desktop)
      .map((p) => ({ url: displayUrl(p.url), reason: p.error ?? (p.status ? `HTTP ${p.status}` : 'not rendered') })),
    repo: repo ? { name: repo.name, frameworks: repo.frameworks, fileCount: repo.fileCount, truncated: repo.truncated } : undefined,
    pages: pages.map((p) => ({
      url: displayUrl(p.url),
      path: p.path,
      status: p.status,
      error: p.error,
      title: p.desktop?.title,
      screenshots: Object.fromEntries(
        (['desktop', 'mobile'] as const)
          .filter((vp) => p[vp]?.screenshot)
          .map((vp) => [vp, { file: `shots/${p[vp]!.screenshot}`, width: VIEWPORTS[vp].width, height: p[vp]!.screenshotHeight ?? 0 }]),
      ),
    })),
  };

  const files: AuditResult['files'] = {};
  if (opts.formats.includes('json')) {
    files.json = path.join(outDir, 'report.json');
    writeFileSync(files.json, JSON.stringify(report, null, 2));
  }
  if (opts.formats.includes('html')) {
    files.html = path.join(outDir, 'report.html');
    writeFileSync(files.html, renderHtml(report, outDir));
  }
  return { report, files, ruleErrors: errors };
}

function limitations(c: Coverage, unmeasured: string[]): string[] {
  const out: string[] = [];
  if (c.renderedNote) out.push(c.renderedNote);
  if (unmeasured.length) out.push(`Not measured, so left out of the overall score: ${unmeasured.join(', ')}.`);
  if (c.routeLimitHit) out.push(`The route limit was reached; ${c.skipped.filter((s) => s.reason.startsWith('route limit')).length} discovered pages were not audited.`);
  if (c.pagesFailed) out.push(`${c.pagesFailed} page${c.pagesFailed === 1 ? '' : 's'} failed to load or returned an error status.`);
  const robots = c.skipped.filter((s) => s.reason.includes('robots')).length;
  if (robots) out.push(`${robots} page${robots === 1 ? ' was' : 's were'} skipped because robots.txt disallows them.`);
  if (c.blockedRequests.length) out.push(`${c.blockedRequests.length}${c.blockedRequests.length === 20 ? '+' : ''} requests were blocked by the network policy (private, loopback, or unsupported addresses).`);
  if (c.networkBudgetExceeded) out.push('The crawl hit its network budget; some resources were not loaded.');
  if (c.rendered) out.push('Technical quality currently covers page metadata only; performance and asset weight are not measured yet.');
  if (c.rendered && !c.interactions) out.push('Button click testing was turned off.');
  return out;
}
