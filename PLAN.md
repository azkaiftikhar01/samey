# samey plan

Originally briefed as "SlopLint", first built as "unslop", renamed to **samey** before launch because the npm name `unslop` belongs to a similar tool. This file tracks what exists against the brief, what is next, and the decisions made along the way. Completed work is logged in [CHANGELOG.md](CHANGELOG.md).

## Status (2026-10-21)

The first vertical slice (brief section 16) is complete, URL security (section 11) is in place, and scoring and the finding schema follow sections 7 and 8. 97 tests pass: unit, security (including an end-to-end adversarial page whose test was verified to fail when the guard is loosened), and end-to-end audits of three fixtures.

## Against the brief

| Section | State |
| --- | --- |
| 4A CLI | Done. `--report` is an alias for `--format`; CI threshold is `--fail-above`. |
| 4B Repository auditing | Mostly done. Framework, routes, static build, placeholders, copied markup, hard-coded values. No PostCSS-based token analysis yet. |
| 4C Rendered auditing | Done, except safe form interaction tests. |
| 4D Visual genericness | Done for the listed deterministic checks. Design brief input is not supported yet. |
| 4E Content analysis | Partly. Placeholders, duplicate paragraphs, stock phrases, claims flagged for verification. Missing: repeated headings and repeated CTA text across pages. |
| 4F Standard checks | **Not done.** Accessibility checks are hand-written; axe-core and Lighthouse are not integrated. No contrast, performance, or asset-weight checks. |
| 4G Outputs | Done, plus a ready-to-paste fix prompt (`fix-prompt.md`, `samey prompt`). |
| 5 Architecture | Single package with engine modules separate from CLI and report. Not a monorepo (the brief allows starting smaller). No Cheerio, PostCSS, or Zod yet. |
| 6 Local models | Partly. Ollama adapter, loopback only, advisory, recorded in the report. Missing: the `LocalVisionAnalyzer` interface, caching by screenshot hash + model + prompt version, page text and structural facts as model input, Zod validation, and an actual evaluation of Qwen and Gemma vision models (no Ollama on the dev machine). |
| 7 Finding model | Done: numeric confidence, fingerprint, verified flag, evidence types, safe source paths, secret redaction, dedup by fingerprint; scan id, versions, viewports, failed routes, limitations, duration. |
| 8 Scoring | Done: `p = s·c·w`, saturating categories, the five brief weights, renormalization over measured categories, versioned config, no labels, deterministic, boundary and dedup tests. Not calibrated. |
| 9 Visual engine | Layers 1, 3, 4 done; layer 2 (screenshot model analysis) is basic. |
| 10 Rules | Functional rules done except forms. Button clicks only report "no effect" after observing DOM, navigation, and errors. |
| 11 Security | URL auditing done (see README "Network safety"). Repository: no implicit script execution, path traversal protection, `.env` files never read, secrets redacted. Model safety: page text is never sent to the model yet. |
| 12 Testing | 3 of 10 fixtures (generic landing, clean distinctive, placeholder/broken mix) plus an inline adversarial page in the security tests. No benchmark suite; none of the beta targets are measured. |
| 15 Tooling | No linter or formatter configured. Nothing committed yet. |

## Next

1. **axe-core and Lighthouse.** Replace the hand-written accessibility rules with axe-core results (keeping touch targets and overflow, which axe does not cover), and add Lighthouse for performance and asset weight under technical quality.
2. **Fixtures and benchmark.** Add the missing fixtures from section 12 (handcrafted but generic, intentional repetition, consistent multi-page design system, broken responsive, delayed rendering and dynamic routes, prompt injection as a standalone site), then a small human-labeled benchmark to start calibrating weights.
3. **Model pipeline.** `LocalVisionAnalyzer` interface, Zod-validated output, cache keyed by screenshot hash + model + prompt version, structural facts as input with page text marked as untrusted, then evaluate a Qwen VL and a Gemma vision model on the fixtures.
4. **Content gaps.** Repeated headings and CTA text across pages; safe form checks (labels, a submit control, no real submission).
5. **Tooling.** ESLint and Prettier, CI running the test suite.
6. **Launch.** Publish to npm (package prepared and verified from a packed tarball), then the posts in the launch plan.

Explicit non-goals for now: hosted dashboard, accounts, browser or editor extensions, automatic code changes, custom model training, remote inference.

## Decisions

- **Name.** samey. The brief called it SlopLint; it was built as unslop, then renamed because `unslop` on npm is an existing tool for AI-generated code anti-patterns, which would confuse search and word of mouth. npm then rejected the bare name `samey` as too similar to existing packages (sade, sane, save), so the package publishes as `samey-cli`; the command stays `samey`.
- **The first brief was truncated** partway through section 4D, so the first slice was built from sections 1 to 4. Once the full brief arrived, the score direction, categories, finding schema, and security model were changed to match it.
- **Node and npm.** Node 24, npm (no pnpm on the machine), ESM, `tsc` build, `tsx` for development, vitest.
- **Dependencies kept small:** commander, picocolors, playwright. The browser is the parser for rendered facts; source checks are line-based.
- **All browser traffic is served from Node.** Playwright's route interception hands every request to a client that resolves DNS, validates every address, and connects to the validated address. The browser never resolves names itself. In remote mode Chromium also gets a dead proxy so preconnects and WebRTC cannot leak.
- **`--dev` is required for non-public `--url` targets.** A server samey starts itself gets loopback only. Metadata addresses are never allowed.
- **Never run project code implicitly.** Dev servers only with `--serve`; `serve` in the config file needs `--serve` on the command line too.
- **Five categories, as in the brief.** Former categories map as: genericness and consistency to visual; copy and credibility to content; functionality and horizontal overflow to functional; accessibility, touch targets, tiny text to accessibility; page metadata to technical.
- **Confidence numbers.** About 0.9 for measurements, 0.6 for structural heuristics, 0.35 for judgment calls, 0.3 for model output.
- **Fingerprints exclude routes**, so the same element in a shared layout is one finding and one penalty, with the other routes listed in `alsoOn`.
- **A single modest stock gradient is `info`**, which carries no penalty: the brief says not to penalize gradients in isolation.
- **Error pages are not content.** A 404 is reported as a broken link and failed route; its markup is not fed to visual rules.
- **Mobile width from `clientWidth`.** Chrome mobile emulation zooms out to fit overflowing content, inflating `innerWidth`.
- **Model output is advisory** and never moves the score.
- **Screenshots are embedded** as base64 JPEG and reused via SVG `<use>`; a 4-page audit report is under 1 MB. Files also stay in `.samey/shots/`.
- **License.** MIT.
