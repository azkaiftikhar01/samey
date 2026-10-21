# Changelog

## 0.2.0

### Added
- Accessibility runs axe-core (WCAG 2.0 to 2.2 A and AA, best practices) inside the guarded browser: colour contrast, names, labels, ARIA, landmarks, target size. Findings are `axe/<check>` with selectors, crops, and the failing HTML.
- Performance category: page weight, JavaScript size, oversized and old-format images, lazy-loaded main image, CLS, main-thread blocking, render-blocking scripts, DOM size, and on deployed sites compression and caching. No load timings (the network guard would distort them).
- SEO category: titles and descriptions, noindex, canonical, Open Graph previews, JSON-LD validity, viewport, links without href, robots.txt and sitemap.
- Best-practices category: HTTPS and mixed content, quirks mode, charset, distorted images, outdated jQuery/Lodash/AngularJS/Moment, favicon.
- Pages are audited in parallel (`--concurrency`, default 3); default route limit raised to 20.
- README section comparing samey with Unlighthouse.

### Changed
- Scoring v3: seven categories; the brief's 10% technical share is split into performance 5%, SEO 3%, best practices 2%. `missing-metadata` is replaced by the SEO title and description rules and axe's lang check.
- Finding ids contain only letters, digits, and dashes.

### Fixed (found by auditing real sites)
- Emoji check counted ©, ®, ™ as emoji.
- Click testing flagged already-selected controls (active filters, current thumbnails).
- Type-scale check counted clamp() half-pixel sizes separately; spacing check flagged consistent rem scales.
- 'Most sections are card grids' had no evidence.
- Next.js `nomodule` polyfills reported as render-blocking; one shared script counted once per page.
- Canonical links to the production domain flagged when auditing a local server.

## 0.1.0 (first npm release as samey-cli)


### Renamed
- The project is now **samey** (was unslop): the npm name `unslop` belongs to an unrelated tool. The command, report branding, output folder (`.samey/`), and config file (`samey.config.json`) all changed. The npm package is `samey-cli` (npm rejects `samey` as too similar to existing packages); the installed command is `samey`.

### Security
- All browser requests are intercepted and performed by a Node client that validates the URL, resolves DNS, rejects names with any non-public address, and pins the connection to the validated address (DNS rebinding).
- Redirects are re-validated hop by hop; loops and long chains are stopped. Per-response (20 MB) and per-crawl (250 MB, 3,000 requests) limits.
- Loopback, private, link-local, reserved, and cloud metadata addresses are blocked, including IPv4-mapped, NAT64, and 6to4 forms and numeric host tricks.
- Service workers, downloads, pop-ups, and (in normal mode) WebSockets are blocked; stray Chromium traffic goes to a dead proxy.
- New `--dev` flag required to audit localhost or private `--url` targets. Metadata addresses stay blocked.
- Secrets in excerpts are redacted; source paths in findings must be relative, inside the project, and in the scanned file set.

### Added
- Every audit writes `.samey/fix-prompt.md`: a ready-to-paste prompt for Claude Code, Cursor or Codex, measured defects first, then design observations, each with page, selector, file:line and the fix. `samey prompt` prints it (`--only-defects` to skip observations). The report's copy buttons use the same text.
- `samey setup` installs Chromium with samey's bundled Playwright.
- The NovaFlow before/after example (`examples/novaflow`) and a demo GIF in the README.

### Fixed
- HTML document boilerplate (doctype, head, meta tags) shared by every page was reported as copy-pasted component markup.
- Sites that redirect (bare domain to `www`, `http` to `https`, moved pages) failed every page with `ERR_PROXY_CONNECTION_FAILED`: Chromium followed redirects from intercepted responses outside the guard. Navigation redirects are now re-checked and followed by the crawler, subresource redirects are followed hop by hop in Node, and a redirecting start URL adopts its final origin.
- Requests samey itself blocked (for example a video over the 20 MB response cap) were reported as failed assets and console errors on the site. They are now listed only under coverage.
- Redirected pages are recorded under the URL they landed on and are not audited twice.
- Reports and progress output show local paths relative to home or the working directory instead of the full path.

### Changed (breaking)
- Score is inverted to match the brief: 0 = no slop indicators, 100 = many or severe. Lower is better.
- Scoring uses `p = s × c × w` per finding and `100 × (1 − e^(−P/100))` per category, with brief weights: visual 40%, content 20%, functional 15%, accessibility 15%, technical 10%. Unmeasured categories are excluded and the rest renormalized.
- Grade labels ("Distinct", "Generic", ...) removed until calibrated.
- Finding schema: `description` (was `message`), numeric `confidence` 0..1, `fingerprint`, `verified`, `ruleVersion`, `routes`. Evidence uses `type`, `route`, `excerpt`, `screenshotPath`, `alsoOn`.
- Report adds `schemaVersion`, `scanId`, `project`, `versions`, `viewports`, `failedRoutes`, `coverage.limitations`, `coverage.blockedRequests`.
- `--fail-under` replaced by `--fail-above`. `--report` added as an alias for `--format`.

### Added
- Deduplication by fingerprint; identical evidence across routes collapses into one item, penalized once.
- Per-rule penalty weights; convention-based rules weigh less.
- A single modest stock gradient is reported as `info` with no penalty.

## 0.1.0

- First vertical slice: CLI, repository scan, Playwright crawl at two viewports, 37 rules, scoring, self-contained HTML and JSON reports, optional local Ollama critique, three fixtures, tests.
