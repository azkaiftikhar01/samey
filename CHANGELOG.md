# Changelog

## Unreleased

### Security
- All browser requests are intercepted and performed by a Node client that validates the URL, resolves DNS, rejects names with any non-public address, and pins the connection to the validated address (DNS rebinding).
- Redirects are re-validated hop by hop; loops and long chains are stopped. Per-response (20 MB) and per-crawl (250 MB, 3,000 requests) limits.
- Loopback, private, link-local, reserved, and cloud metadata addresses are blocked, including IPv4-mapped, NAT64, and 6to4 forms and numeric host tricks.
- Service workers, downloads, pop-ups, and (in normal mode) WebSockets are blocked; stray Chromium traffic goes to a dead proxy.
- New `--dev` flag required to audit localhost or private `--url` targets. Metadata addresses stay blocked.
- Secrets in excerpts are redacted; source paths in findings must be relative, inside the project, and in the scanned file set.

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
