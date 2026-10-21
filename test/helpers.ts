import type { CrawlResult, PageFacts, SectionFact, ViewportFacts } from '../src/types.js';

const rect = { x: 0, y: 0, width: 1440, height: 600 };

export function section(over: Partial<SectionFact> = {}): SectionFact {
  return {
    index: 0, selector: 'section', rect, tag: 'section', signature: 'sec|h1|c0|cols1|cards0|-|b0|i0|||', heading: 'Heading', text: 'Some text',
    centered: false, columns: 1, cardCount: 0, buttonCount: 0, imageCount: 0, hasBlockquote: false, hasDetails: false, hasPrice: false, isChrome: false, ...over,
  };
}

export function viewport(over: Partial<ViewportFacts> = {}): ViewportFacts {
  return {
    viewport: 'desktop', width: 1440, height: 900, docHeight: 3000, scrollWidth: 1440, lang: 'en', title: 'Page', metaDescription: 'desc',
    sections: [], headings: [{ selector: 'h1', rect, level: 1, text: 'Title' }], controls: [], links: [], images: [], textBlocks: [], gradients: [], glows: [],
    styles: { colors: {}, backgrounds: {}, fontSizes: {}, fontFamilies: {}, radii: {}, shadows: {}, spacing: {} },
    smallTargets: [], tinyText: [], overflowing: [], unlabeledInputs: [], wordCount: 400, rootFontSize: 16, ...over,
  };
}

export function page(path: string, desktop: Partial<ViewportFacts> = {}, extra: Partial<PageFacts> = {}): PageFacts {
  return { url: `http://127.0.0.1:1${path}`, path, status: 200, loadMs: 10, consoleErrors: [], failedRequests: [], interactions: [], desktop: viewport(desktop), ...extra };
}

export function crawlOf(pages: PageFacts[], over: Partial<CrawlResult> = {}): CrawlResult {
  return { baseUrl: 'http://127.0.0.1:1/', pages, skipped: [], brokenLinks: [], discovered: pages.length, limitHit: false, network: { blocked: [], requests: 0, bytes: 0, budgetExceeded: false }, ...over };
}
