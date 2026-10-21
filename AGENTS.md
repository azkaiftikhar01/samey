# Notes for coding agents

Two audiences: agents working on samey itself, and agents fixing a site using an samey report.

## Working on samey

### Layout

```
src/
  cli.ts              command-line entry (commander)
  audit.ts            orchestration: scan repo, pick target, crawl, run rules, score, write reports
  config.ts           options, defaults, samey.config.json loading
  types.ts            all shared types: facts, findings, report
  score.ts            versioned scoring config, saturating category scores, prioritization
  security/
    net-policy.ts     address classification, URL checks, DNS resolution and validation
    fetch.ts          HTTP client pinned to validated addresses, redirect re-validation, size limits
  static/scan.ts      repository walk, framework detection, route hints, text-to-source lookup
  render/
    server.ts         read-only static server, dev server launcher
    crawl.ts          Playwright crawl: two viewports, console and network capture, link checks
    network.ts        serves every browser request through security/fetch.ts; blocks websockets, popups
    extract.ts        the in-browser fact extractor
    interact.ts       safe button clicking
    robots.ts         robots.txt rules
  rules/
    visual.ts         genericness and design-token rules (rendered)
    content.ts        copy, credibility, link-text rules (rendered)
    functional.ts     broken behaviour, responsive, accessibility rules (rendered)
    static.ts         source-tree rules, several mirroring rendered rules via mergeInto
    normalize.ts      validation, path safety, secret redaction, evidence collapsing, fingerprints, dedup
    index.ts          registry, source-location tracing, static-to-rendered merging
  report/             html.ts (self-contained report), prompt.ts (fix prompt), terminal.ts
  ai/local-model.ts   optional Ollama critique, loopback only, advisory
test/                 vitest; e2e.test.ts audits the fixtures, security.test.ts covers SSRF
fixtures/             sloppy-site, clean-site, react-app
```

### Commands

- `npm test` runs everything. End-to-end tests skip themselves if Chromium is not installed.
- `npm run typecheck`, `npm run build`.
- `npm run dev -- audit fixtures/sloppy-site` runs the CLI from source.

### Rules of the codebase

- **Never fabricate.** A finding must come from measured facts. Evidence must point at something that exists: a selector on a rendered page, a `file:line` found by exact match, a URL that failed. If a source location cannot be found reliably, leave it out.
- **Rules are pure functions** of `RuleContext` (crawl facts and/or repo facts) that return `FindingInput[]`. They do not launch browsers or read files. Add new facts in `extract.ts` or `scan.ts`, then a rule that reads them.
- **The extractor runs in the browser.** `extractInPage` in `render/extract.ts` is serialized with `toString()`. It must not reference imports, module-level variables, or helpers defined outside its body.
- **Guard against false positives.** Every new genericness rule needs a test that the clean fixture does not trigger it. Common conventions alone (a nav with backdrop blur, a pricing table) should not be penalized.
- **Confidence is honest.** A number from 0 to 1: about 0.9 for direct measurements, 0.6 for structural heuristics, 0.3 to 0.35 for things that need human judgment (claims, testimonials, model output). Severity is separate from confidence.
- **Verified or observation.** Each rule declares `verified: true` (a measured defect) or `false` (a design observation). Rules about popular conventions get a lower `penalty`.
- **All network access goes through `security/`.** Never call `fetch`, `page.request`, or `context.request` directly on audited URLs; use `guardedFetch`. Any change to the network path needs a test in `security.test.ts`, and the adversarial test must fail if the guard is loosened.
- **Bump `version`** on a rule when its logic changes its findings, and `SCORING.version` when the scoring config changes.
- **No remote inference.** Model calls go only to loopback endpoints and never affect the score.
- **No code execution without consent.** Project scripts run only via `--serve` on the command line.
- Keep `README.md` and `PLAN.md` accurate when behaviour changes.

## Fixing a site from an samey report

The quickest start is `.samey/fix-prompt.md` (or `npx samey-cli prompt`): the findings as a prompt, defects first. For structured data, read `.samey/report.json`. The parts you need:

```ts
{
  schemaVersion: 1,
  scanId: string,
  score: number | null,                 // 0 = no slop indicators, 100 = many or severe; null = nothing measured
  categories: Array<{ category, score: number | null, weight, penalty }>,
  coverage: { rendered: boolean, limitations: string[], skipped: {url, reason}[], blockedRequests: {url, reason}[] },
  failedRoutes: Array<{ url, reason }>,
  versions: { scoring: string, rules: Record<string, number>, model?: string },
  findings: Array<{
    id: string,                         // `${ruleId}-${fingerprint prefix}`, stable across runs for the same evidence
    fingerprint: string,
    ruleId: string,                     // see `samey rules`
    ruleVersion: number,
    title: string,
    category: 'visual' | 'content' | 'functional' | 'accessibility' | 'technical',
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info',
    confidence: number,                 // 0 to 1
    verified: boolean,                  // true = measured defect, false = design observation
    source: 'rendered' | 'static' | 'model',
    advisory?: boolean,                 // model observations; treat as suggestions
    description: string,
    recommendation: string,
    routes?: string[],
    evidence: Array<{
      type: 'dom' | 'source' | 'screenshot' | 'metric' | 'text' | 'network' | 'console',
      route?: string, alsoOn?: string[], viewport?: 'desktop' | 'mobile',
      selector?: string, file?: string, line?: number,
      excerpt?: string, detail?: string, screenshotPath?: string
    }>
  }>
}
```

Findings are already sorted in fix-first order. Suggested approach:

1. Fix `critical` and `high` findings with `verified: true` first; they are measured breakage.
2. Use `file` and `line` when present. Otherwise search the source for the `excerpt` text, or map `selector` and `route` to the component that renders it. `alsoOn` means the same element appears on other routes, usually a shared component: fix it once.
3. For genericness findings, change the design decision, not just the one element: replace the gradient token, vary the section layouts, rewrite the copy with specifics.
4. Treat findings with confidence below 0.5 as questions for the user (for example whether a "10,000+ users" claim is real) rather than deleting content on your own.
5. Rerun `samey audit` and confirm the finding is gone.
