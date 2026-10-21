import type { Page } from 'playwright';
import type { ControlFact, InteractionResult } from '../types.js';
import { runInPage } from './extract.js';

/** Labels that suggest a click could change data, spend money, or end a session. Never clicked. */
const UNSAFE = /\b(?:delete|remove|destroy|erase|buy|pay|purchase|checkout|order|subscribe|unsubscribe|log ?out|sign ?out|submit|send|confirm|cancel (?:plan|subscription)|reset|deploy|publish|charge|transfer|donate)\b/i;

export function isSafeControl(c: ControlFact): boolean {
  if (c.inForm) return false;
  if (c.type === 'submit' || c.type === 'reset') return false;
  if (c.tag === 'a') return false; // links are covered by the crawler and link checks
  if (c.href) return false;
  if (!c.name && !c.text) return false; // empty buttons are reported separately
  if (UNSAFE.test(c.name) || UNSAFE.test(c.text)) return false;
  if (c.rect.width < 4 || c.rect.height < 4) return false;
  return true;
}

function installObserver(): void {
  const w = window as unknown as { __unslopMutations?: number; __unslopObs?: MutationObserver };
  w.__unslopMutations = 0;
  w.__unslopObs?.disconnect();
  w.__unslopObs = new MutationObserver((list) => {
    w.__unslopMutations = (w.__unslopMutations ?? 0) + list.length;
  });
  w.__unslopObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
}

function readMutations(): number {
  return (window as unknown as { __unslopMutations?: number }).__unslopMutations ?? 0;
}

/**
 * Clicks a handful of safe, visible buttons and records whether anything observable
 * happened (navigation, DOM change). Restores the page after navigations.
 */
export async function testInteractions(page: Page, controls: ControlFact[], limit: number, timeoutMs: number): Promise<InteractionResult[]> {
  const results: InteractionResult[] = [];
  const startUrl = page.url();
  const candidates = controls.filter(isSafeControl).slice(0, limit);
  for (const c of candidates) {
    const base = { selector: c.selector, rect: c.rect, text: c.name || c.text };
    try {
      if (page.url() !== startUrl) await page.goto(startUrl, { waitUntil: 'load', timeout: timeoutMs });
      const loc = page.locator(c.selector).first();
      if (!(await loc.isVisible({ timeout: 500 }).catch(() => false))) {
        results.push({ ...base, outcome: 'skipped', detail: 'not visible at click time' });
        continue;
      }
      await runInPage(page, installObserver, undefined);
      const errors: string[] = [];
      const onError = (e: Error) => errors.push(e.message);
      page.on('pageerror', onError);
      await loc.click({ timeout: Math.min(timeoutMs, 3000) });
      await page.waitForTimeout(600);
      page.off('pageerror', onError);
      if (page.url() !== startUrl) {
        results.push({ ...base, outcome: 'navigated', detail: page.url() });
        continue;
      }
      if (errors.length) {
        results.push({ ...base, outcome: 'error', detail: errors[0].slice(0, 200) });
        continue;
      }
      const mutations = await runInPage(page, readMutations, undefined);
      results.push({ ...base, outcome: mutations > 0 ? 'changed' : 'no-effect', detail: mutations > 0 ? `${mutations} DOM mutations` : undefined });
      // Close anything the click opened so the next control starts from a similar state.
      await page.keyboard.press('Escape').catch(() => undefined);
    } catch (err) {
      results.push({ ...base, outcome: 'skipped', detail: (err as Error).message.split('\n')[0].slice(0, 160) });
    }
  }
  return results;
}
