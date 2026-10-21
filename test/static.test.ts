import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/index.js';
import { locateText, scanRepo } from '../src/static/scan.js';

const reactApp = path.resolve(__dirname, '../fixtures/react-app');

describe('repository scan', () => {
  const repo = scanRepo(reactApp);

  it('detects frameworks and static routes, skipping dynamic ones', () => {
    expect(repo.frameworks).toEqual(expect.arrayContaining(['Next.js', 'React', 'Tailwind CSS']));
    expect(repo.routeHints).toEqual(expect.arrayContaining(['/', '/pricing']));
    expect(repo.routeHints.some((r) => r.includes('['))).toBe(false);
    expect(repo.staticRoot).toBeUndefined();
  });

  it('reports static findings with exact file and line', () => {
    const { findings } = runRules({ repo });
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(['src-stock-gradient', 'src-emoji-icons', 'src-placeholder-content', 'src-stock-copy', 'duplicated-markup']));
    const gradient = findings.find((f) => f.ruleId === 'src-stock-gradient')!;
    expect(gradient.evidence[0]).toMatchObject({ file: 'src/components/Hero.tsx', line: 3 });
    const emoji = findings.find((f) => f.ruleId === 'src-emoji-icons')!;
    expect(emoji.evidence.map((e) => e.line)).toEqual([6, 12, 18]);
  });

  it('locates rendered text in source, preferring the file named after the page', () => {
    const site = scanRepo(path.resolve(__dirname, '../fixtures/sloppy-site'));
    const [loc] = locateText(site.files, 'Blazing fast performance that scales effortlessly', 1, '/features');
    expect(loc.file).toBe('features.html');
    expect(locateText(site.files, 'short', 1)).toEqual([]);
  });

  it('serves a plain HTML project as-is', () => {
    expect(scanRepo(path.resolve(__dirname, '../fixtures/clean-site')).staticRoot).toBe(path.resolve(__dirname, '../fixtures/clean-site'));
  });
});
