import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { runAudit } from '../src/audit.js';
import { DEFAULTS } from '../src/config.js';

const hasBrowser = existsSync(chromium.executablePath());
const out = mkdtempSync(path.join(os.tmpdir(), 'samey-e2e-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

const audit = (fixture: string, extra = {}) =>
  runAudit({ ...DEFAULTS, path: path.resolve(__dirname, '../fixtures', fixture), outDir: path.join(out, fixture), ai: false, ...extra });

describe.skipIf(!hasBrowser)('end to end', () => {
  it('finds the planted problems in the sloppy site', async () => {
    const { report, files } = await audit('sloppy-site');
    const ids = report.findings.map((f) => f.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'stock-gradient', 'glow-effects', 'emoji-icons', 'card-grid-sameness', 'stock-copy', 'placeholder-content', 'broken-internal-links',
        'console-errors', 'placeholder-links', 'empty-controls', 'horizontal-overflow', 'unresponsive-buttons', 'broken-images',
      ]),
    );
    expect(report.coverage.rendered).toBe(true);
    expect(report.pages.map((p) => p.path)).toEqual(expect.arrayContaining(['/', '/about', '/features']));
    expect(report.score!).toBeGreaterThan(40);

    const overflow = report.findings.find((f) => f.ruleId === 'horizontal-overflow')!;
    expect(overflow.evidence.some((e) => e.viewport === 'mobile' && e.selector)).toBe(true);
    const placeholder = report.findings.find((f) => f.ruleId === 'placeholder-content')!;
    expect(placeholder.evidence.some((e) => e.file === 'index.html' && typeof e.line === 'number')).toBe(true);
    expect(overflow.evidence.some((e) => e.screenshotPath?.startsWith('shots/'))).toBe(true);

    // Report schema (section 7): stable ids, numeric confidence, versions, coverage.
    for (const f of report.findings) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
      expect(f.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof f.verified).toBe('boolean');
    }
    expect(new Set(report.findings.map((f) => f.fingerprint)).size).toBe(report.findings.length);
    expect(report.versions.rules['stock-gradient']).toBe(1);
    expect(report.viewports.map((v) => v.name)).toEqual(['desktop', 'mobile']);
    expect(report.failedRoutes.map((r) => r.url)).toEqual([expect.stringContaining('/careers')]);
    const json = JSON.parse(readFileSync(files.json!, 'utf8'));
    expect(json.schemaVersion).toBe(1);
    expect(json.scanId).toBe(report.scanId);

    const html = readFileSync(files.html!, 'utf8');
    expect(html).toContain('data:image/jpeg;base64,');
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href="http/); // self-contained
  });

  it('keeps the clean site free of genericness findings', async () => {
    const { report } = await audit('clean-site');
    const bad = report.findings.filter((f) => ['visual', 'content', 'functional'].includes(f.category));
    expect(bad.map((f) => f.ruleId)).toEqual([]);
    expect(report.score!).toBeLessThanOrEqual(10);
  });

  it('honors the route limit and reports skipped pages', async () => {
    const { report } = await audit('sloppy-site', { maxRoutes: 1, interact: false, screenshots: false });
    expect(report.pages).toHaveLength(1);
    expect(report.coverage.routeLimitHit).toBe(true);
    expect(report.coverage.skipped.length).toBeGreaterThan(0);
  });
});

describe('static only', () => {
  it('runs without a browser and marks rendered categories as not measured', async () => {
    const { report } = await audit('react-app', { staticOnly: true });
    expect(report.coverage.rendered).toBe(false);
    expect(report.categories.find((c) => c.category === 'functional')!.score).toBeNull();
    expect(report.findings.length).toBeGreaterThan(0);
  });
});
