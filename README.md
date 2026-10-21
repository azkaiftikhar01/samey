# samey

Lint your AI-built UI.

samey audits a website built with Claude Code, Cursor, Codex, or any other coding agent and reports what makes it feel generic, broken, or unfinished: stock gradients and glow effects, the same card grid in every section, interchangeable marketing copy, placeholder content, dead links and buttons, mobile overflow, and accessibility gaps. Every finding comes with evidence (page, selector, screenshot crop, and `file:line` when it can be traced to source) and a concrete fix.

It runs entirely on your machine. There is no account, no API key, and no cloud inference. An optional local vision model can add an advisory critique, but the core engine is deterministic and works without one.

samey measures observable patterns. It does not try to determine whether a site was written by AI, and it does not penalize a site just for using popular conventions.

## Quick start

```bash
npm install
npx playwright install chromium   # once, for rendered checks
npm run build

# a project with a static build (out/, dist/, build/, or plain HTML)
node dist/cli.js audit ./my-site

# a project with a dev server (samey starts it, audits it, stops it)
node dist/cli.js audit ./my-app --serve "npm run dev" --port 3000

# a deployed site
node dist/cli.js audit --url https://my-app.vercel.app
node dist/cli.js audit ./my-app --url https://my-app.vercel.app

# a dev server you already started (local addresses need --dev)
node dist/cli.js audit ./my-app --url http://localhost:3000 --dev
```

The report is written to `<project>/.samey/report.html` (self-contained, open it in any browser) and `report.json`. Add `.samey/` to your `.gitignore`.

## What you get

- A slop score from 0 to 100, where **lower is better**: 0 means no slop indicators were found. Plus a score per category: visual genericness, content genericness, functional defects, accessibility and usability, technical quality.
- A "fix first" list ordered by severity and confidence. Each finding is marked as a verified defect (measured) or a design observation (a heuristic that needs your judgment).
- Each finding with evidence: the page and viewport, CSS selector, a screenshot crop with the element outlined, the source line where the text or class lives, and a recommendation.
- Desktop (1440px) and mobile (390px) screenshots of each audited page.
- A "copy fix prompt" button on every finding, and a tray to combine selected findings into one prompt you can paste into your coding agent. Rerun samey afterwards to verify.

## Commands

```
samey audit [path] [options]
samey rules
```

| Option | Default | Description |
| --- | --- | --- |
| `-u, --url <url>` | | Audit a running site. Overrides any local server. |
| `--dev` | | Development mode: lets `--url` point at localhost or a private network address. |
| `--serve [command]` | | Start the dev server with this command (`npm run dev` if omitted). This runs project code, so it only happens when you pass the flag. |
| `--port <port>` | 4173 | Port the dev server listens on. `PORT` is set in its environment. |
| `--max-routes <n>` | 10 | Maximum pages to render. Skipped pages are listed in the report. |
| `--timeout <seconds>` | 30 | Navigation timeout per page. |
| `--route <path...>` | | Extra routes to audit. |
| `--format <html\|json\|both>` | both | Which reports to write. `--report` is an alias. |
| `-o, --out <dir>` | `<path>/.samey` | Output directory. |
| `--static-only` | | Only scan source files; do not launch a browser. |
| `--no-screenshots` | | Skip screenshots. |
| `--no-interact` | | Do not click any buttons. |
| `--ignore-robots` | | Crawl pages disallowed by robots.txt. Only for sites you own. |
| `--ignore <rules...>` | | Rule ids to skip (see `samey rules`). |
| `--fail-above <score>` | | Exit with code 1 if the slop score is above this. For CI. |
| `--model <name>` | | Local Ollama vision model for an advisory critique. |
| `--model-endpoint <url>` | `http://127.0.0.1:11434` | Must be a loopback address. |
| `--no-ai` | | Never use a model, even if one is configured. |
| `--json` | | Print the JSON report to stdout. |
| `-q, --quiet` | | Only print the final summary. |

Exit codes: `0` success, `1` score above `--fail-above`, `2` the audit could not run (bad arguments, a blocked or unreachable URL, no page could be rendered, dev server failed to start).

### Config file

`samey.config.json` in the project root sets defaults. Command-line flags win.

```json
{
  "maxRoutes": 15,
  "routes": ["/pricing", "/docs"],
  "ignoreRules": ["centered-everything"],
  "failAbove": 30,
  "serve": "pnpm dev",
  "port": 5173
}
```

`serve` in the config file is only used when you also pass `--serve` on the command line, so cloning an untrusted repository and running `samey audit .` never executes its code.

## How the target is chosen

1. `--url` if given. Public addresses only, unless you pass `--dev`.
2. Otherwise, with `--serve`, the dev server samey starts.
3. Otherwise, a static build in the project (`out/`, `dist/`, `build/`, `_site/`), or the project root if it is plain HTML. samey serves it read-only on 127.0.0.1.
4. Otherwise only static analysis runs, and the report says so. Categories that need a rendered page show n/a rather than a perfect score.

Routes are discovered from links, `sitemap.xml`, `--route`, and route files in the project (Next.js `app/` and `pages/`, SvelteKit, Astro, React Router paths). Dynamic routes like `/blog/[slug]` are skipped.

## What it checks

Run `samey rules` for the full list. In summary:

**Visual genericness**: blue-violet-pink gradients (including gradient text), decorative glows, blur blobs and glass panels, one card composition reused across sections, consecutive sections with identical layout, different pages built from the same skeleton, the stock hero-logos-features-testimonials-pricing-FAQ-CTA sequence, centered everything, emoji used as icons.

**Copy and credibility**: stock marketing phrases ("unlock the power", "seamless", "next-generation"), placeholder content (lorem ipsum, Jane Doe, Acme, example.com, placeholder image services), repeated paragraphs, unsourced user counts and ratings, testimonials with only a name and title.

**Functionality**: pages that fail to load, broken internal links, console errors, failed requests, links to `#`, buttons that do nothing when clicked, broken images, missing titles and descriptions.

**Responsive and accessibility**: horizontal scrolling, touch targets under 24px, text under 12px on mobile, controls without accessible names, images without alt, unlabeled inputs, heading structure, vague link text.

**Design consistency**: too many font sizes, radii, shadows, or font families; spacing off a 4px scale; hard-coded values bypassing tokens; markup copy-pasted instead of extracted into components.

Static checks on the source tree mirror several rendered checks. When both fire, the source lines are attached to the rendered finding as evidence instead of being reported twice.

### Safe click testing

On each page, samey clicks up to six visible buttons to see whether anything happens. It never clicks links (those are checked by the crawler), anything inside a form, submit buttons, or anything labelled like delete, buy, pay, checkout, subscribe, log out, send, confirm, and similar. Use `--no-interact` to turn this off.

## Scoring

The score counts detected quality problems. It is not a probability that AI wrote the site.

Each finding adds a penalty `p = s × c × w`:

- `s`, severity: info 0, low 0.25, medium 0.5, high 0.75, critical 1
- `c`, confidence: a number from 0 to 1
- `w`, the rule's weight: 40 by default, lower for rules about conventions (centered layouts, the landing-page sequence, unverified claims), higher for hard failures (a page that does not load: 80)

Within a category the penalties add up to `P`, and the category score is `100 × (1 − e^(−P/100))`, so a pile of minor findings approaches 100 but never passes it. The overall score is the weighted average of the measured categories:

| Category | Weight |
| --- | ---: |
| Visual genericness | 40% |
| Content genericness | 20% |
| Functional defects | 15% |
| Accessibility and usability | 15% |
| Technical quality | 10% |

Categories that could not be measured (for example functional defects in a static-only run) are shown as "not measured" and left out, with the remaining weights renormalized. Identical evidence on several pages, such as a broken link in a shared footer, counts once. The same set of findings always produces the same score. Weights and penalties are starting hypotheses, versioned in the report (`versions.scoring`), and have not yet been calibrated against human judgments, so there are deliberately no labels like "good" or "bad".

## Network safety

Every request the browser makes is intercepted and performed by samey itself, so the audited page cannot use the browser to reach places it should not:

- Only `http` and `https`. URLs with embedded credentials are refused.
- In normal mode only public addresses are reachable. Loopback, private (including carrier-grade NAT), link-local, multicast, documentation, and other reserved ranges are blocked, including IPv4-mapped, NAT64, and 6to4 IPv6 forms and numeric tricks like `http://2130706433/`.
- Hostnames are resolved before connecting, every returned address must be allowed, and the connection is pinned to the checked address, which defeats DNS rebinding.
- Every redirect hop is checked again. Redirect loops and chains longer than 5 hops are stopped.
- Responses are capped at 20 MB each and 250 MB per crawl, with 3,000 requests at most.
- Service workers, downloads, and pop-up windows are blocked. WebSockets are blocked in normal mode. Anything Chromium tries to send outside the interception (preconnects, WebRTC) goes to a closed local port.
- Cloud metadata addresses (169.254.169.254 and others) are never reachable, even with `--dev`.
- With `--dev`, loopback and private addresses are allowed so you can audit a local server. When samey starts the server itself (static build or `--serve`), only loopback is allowed.
- Crawling stays on the starting origin. Pages that redirect to another site are skipped.

Blocked requests are listed in the report's coverage section. Text on the audited page is treated as content, never as instructions.

## Optional local model

```bash
ollama pull qwen2.5vl:7b
samey audit . --model qwen2.5vl:7b
```

samey sends up to three desktop screenshots to the model and asks for specific visual observations. Only loopback endpoints are accepted, so screenshots never leave your machine. Model observations are marked advisory, given confidence 0.3, and never change the score. No model has been benchmarked with samey yet; the model name is recorded in the report. If no model is configured or the server is not running, the audit runs normally and the report notes it.

## Using it with a coding agent

1. Run `samey audit .`.
2. Open the report, tick the findings you want fixed, and click "Copy fix prompt" (or point the agent at `.samey/report.json`).
3. Paste into Claude Code, Cursor, or Codex.
4. Run samey again to confirm the findings are gone.

See [AGENTS.md](AGENTS.md) for the JSON shape an agent can rely on.

## Limits

- Ten routes and two viewports by default. Large sites are sampled, not exhausted.
- Accessibility checks are samey's own, not axe-core yet, and technical quality covers page metadata only (no Lighthouse yet). See PLAN.md.
- Heuristics are tuned to avoid false positives on plain, well-built pages, but they are heuristics. Low-confidence findings are worth a look, not an automatic fix.
- Single-page apps that render routes without real URLs only get their first screen audited.
- samey never modifies your source files.

## Development

```bash
npm install
npx playwright install chromium
npm test            # unit, security, and end-to-end tests
npm run typecheck
npm run dev -- audit fixtures/sloppy-site   # run from source
```

`fixtures/sloppy-site` is a deliberately generic multi-page site, `fixtures/clean-site` is a plain site that should produce no genericness findings, and `fixtures/react-app` is a source tree for static analysis. See [PLAN.md](PLAN.md) for status and next steps.

## License

MIT
