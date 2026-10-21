import type { CrawlResult, ElementRef, Evidence, PageFacts, ViewportFacts, ViewportName } from '../types.js';

export function pagesWith(crawl: CrawlResult | undefined, vp: ViewportName): { page: PageFacts; facts: ViewportFacts }[] {
  if (!crawl) return [];
  const out: { page: PageFacts; facts: ViewportFacts }[] = [];
  for (const page of crawl.pages) {
    const facts = page[vp];
    if (facts) out.push({ page, facts });
  }
  return out;
}

export function el(page: PageFacts, vp: ViewportName, ref: ElementRef, excerpt?: string, detail?: string): Evidence {
  return { type: 'dom', route: page.path, viewport: vp, selector: ref.selector, rect: ref.rect, excerpt, detail };
}

export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function uniqueRoutes(evidence: Evidence[]): string[] {
  return [...new Set(evidence.map((e) => e.route).filter((p): p is string => !!p))];
}

/** True if the element sits inside a header/nav/footer section of the page. */
export function inChrome(facts: ViewportFacts, ref: ElementRef): boolean {
  return facts.sections.some(
    (s) => s.isChrome && ref.rect.y >= s.rect.y - 1 && ref.rect.y + ref.rect.height <= s.rect.y + s.rect.height + 1,
  );
}

export function topEntries(rec: Record<string, number>, n: number): [string, number][] {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}
