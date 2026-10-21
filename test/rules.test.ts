import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/index.js';
import { classifySection } from '../src/rules/visual.js';
import { crawlOf, page, section, viewport } from './helpers.js';

const ids = (c: ReturnType<typeof crawlOf>) => runRules({ crawl: c }).findings.map((f) => f.ruleId);
const r = { x: 0, y: 100, width: 600, height: 80 };

describe('visual rules', () => {
  it('flags stock gradients and ignores tiny ones', () => {
    const c = crawlOf([
      page('/', {
        gradients: [
          { selector: '.hero', rect: { x: 0, y: 0, width: 1440, height: 600 }, area: 1440 * 600, isText: false, value: 'linear-gradient(135deg, rgb(99, 102, 241), rgb(236, 72, 153))' },
          { selector: '.dot', rect: { x: 0, y: 0, width: 8, height: 8 }, area: 64, isText: false, value: 'linear-gradient(rgb(99, 102, 241), rgb(236, 72, 153))' },
        ],
      }),
    ]);
    const f = runRules({ crawl: c }).findings.find((x) => x.ruleId === 'stock-gradient')!;
    expect(f.evidence).toHaveLength(1);
    expect(f.severity).toBe('medium');
  });

  it('flags a card composition repeated across sections', () => {
    const cards = (h: string) => section({ heading: h, cardCount: 3, columns: 3, cardSignature: 'div[h3,p]', signature: 'sec|cards3' });
    const c = crawlOf([page('/', { sections: [cards('A'), cards('B')] }), page('/about', { sections: [cards('C')] })]);
    expect(ids(c)).toContain('card-grid-sameness');
    const two = crawlOf([page('/', { sections: [cards('A'), cards('B')] })]);
    expect(ids(two)).not.toContain('card-grid-sameness');
  });

  it('compares templates across page types but not within a group', () => {
    const secs = () => ['a', 'b', 'c', 'd'].map((s) => section({ signature: s }));
    const same = crawlOf([page('/', { sections: secs() }), page('/about', { sections: secs() }), page('/pricing', { sections: secs() })]);
    expect(ids(same)).toContain('cross-page-template');
    const blog = crawlOf([page('/', { sections: [section({ signature: 'x' }), section({ signature: 'y' }), section({ signature: 'z' })] }), page('/blog/a', { sections: secs() }), page('/blog/b', { sections: secs() })]);
    expect(ids(blog)).not.toContain('cross-page-template');
  });

  it('does not flag consecutive plain prose sections', () => {
    const prose = () => section({ signature: 'sec|prose' });
    expect(ids(crawlOf([page('/', { sections: [prose(), prose(), prose()] })]))).not.toContain('repeated-section-rhythm');
    const grid = () => section({ signature: 'sec|grid', cardCount: 3, columns: 3 });
    expect(ids(crawlOf([page('/', { sections: [grid(), grid(), grid()] })]))).toContain('repeated-section-rhythm');
  });

  it('classifies landing page sections', () => {
    expect(classifySection(section({ buttonCount: 2 }), 0, 6)).toBe('hero');
    expect(classifySection(section({ heading: 'Simple pricing', hasPrice: true }), 3, 6)).toBe('pricing');
    expect(classifySection(section({ heading: 'Frequently asked questions', hasDetails: true }), 4, 6)).toBe('faq');
  });

  it('needs at least two emoji labels', () => {
    const one = crawlOf([page('/', { textBlocks: [{ selector: 'h3', rect: r, tag: 'h3', text: '🚀 Fast' }] })]);
    expect(ids(one)).not.toContain('emoji-icons');
    const two = crawlOf([page('/', { textBlocks: [{ selector: 'h3', rect: r, tag: 'h3', text: '🚀 Fast' }, { selector: 'h3:nth-of-type(2)', rect: r, tag: 'h3', text: '🔒 Safe' }] })]);
    expect(ids(two)).toContain('emoji-icons');
  });

  it('flags too many font sizes but not a normal scale', () => {
    const sizes = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${12 + i}px`, 3]));
    expect(ids(crawlOf([page('/', { styles: { ...viewport().styles, fontSizes: sizes(8) } })]))).not.toContain('token-sprawl');
    expect(ids(crawlOf([page('/', { styles: { ...viewport().styles, fontSizes: sizes(16) } })]))).toContain('token-sprawl');
  });
});

describe('functional rules', () => {
  it('reports dead links, empty controls, overflow, and button outcomes', () => {
    const c = crawlOf([
      page(
        '/',
        {
          links: [{ selector: 'a', rect: r, href: '#', text: 'Blog', internal: true }],
          controls: [{ selector: 'button', rect: r, tag: 'button', text: '', name: '', inForm: false }],
        },
        {
          mobile: viewport({ viewport: 'mobile', width: 390, scrollWidth: 600, overflowing: [{ selector: '.wide', rect: r, right: 600 }] }),
          interactions: [{ selector: '.go', rect: r, text: 'Start', outcome: 'no-effect' }],
          consoleErrors: ['Uncaught: boom'],
        },
      ),
    ]);
    const found = ids(c);
    expect(found).toEqual(expect.arrayContaining(['placeholder-links', 'empty-controls', 'horizontal-overflow', 'unresponsive-buttons', 'console-errors']));
  });

  it('ignores 404s that only came from route hints', () => {
    const c = crawlOf([page('/')], { brokenLinks: [{ from: '(route hint)', url: 'http://x/old', status: 404 }] });
    expect(ids(c)).not.toContain('broken-internal-links');
    const real = crawlOf([page('/')], { brokenLinks: [{ from: '/', url: 'http://x/careers', status: 404 }] });
    expect(ids(real)).toContain('broken-internal-links');
  });

  it('can ignore rules by id', () => {
    const c = crawlOf([page('/', { links: [{ selector: 'a', rect: r, href: '#', text: 'Blog', internal: true }] })]);
    expect(runRules({ crawl: c }, ['placeholder-links']).findings.map((f) => f.ruleId)).not.toContain('placeholder-links');
  });
});
