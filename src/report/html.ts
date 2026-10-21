import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATEGORY_LABELS, SCORING } from '../score.js';
import type { AuditReport, Evidence, Finding, Severity } from '../types.js';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Note' };

const ICON = {
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>',
  file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7z"/><path d="M9.5 2.5v3h3"/></svg>',
  page: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11"/></svg>',
  term: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5l3 3-3 3M8 11h5"/></svg>',
  net: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.8 1.6 1.8 9.4 0 11M8 2.5c-1.8 1.6-1.8 9.4 0 11"/></svg>',
  metric: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13V8M8 13V3M13 13v-6"/></svg>',
};

interface Shot {
  id: string;
  width: number;
  height: number;
}

function loadShots(report: AuditReport, outDir: string): { defs: string; byPage: Map<string, Partial<Record<'desktop' | 'mobile', Shot>>> } {
  const byPage = new Map<string, Partial<Record<'desktop' | 'mobile', Shot>>>();
  const parts: string[] = [];
  report.pages.forEach((p, i) => {
    const entry: Partial<Record<'desktop' | 'mobile', Shot>> = {};
    for (const vp of ['desktop', 'mobile'] as const) {
      const s = p.screenshots[vp];
      if (!s) continue;
      const file = path.join(outDir, s.file);
      if (!existsSync(file)) continue;
      const id = `shot-${i}-${vp}`;
      const data = readFileSync(file).toString('base64');
      parts.push(`<image id="${id}" href="data:image/jpeg;base64,${data}" width="${s.width}" height="${s.height}" preserveAspectRatio="none"/>`);
      entry[vp] = { id, width: s.width, height: s.height };
    }
    byPage.set(p.path, entry);
  });
  return { defs: parts.length ? `<svg class="defs" width="0" height="0" aria-hidden="true"><defs>${parts.join('')}</defs></svg>` : '', byPage };
}

function crop(e: Evidence, shot: Shot | undefined): string {
  if (!shot || !e.rect) return '';
  const r = e.rect;
  if (r.y >= shot.height || r.width < 2 || r.height < 2) return '';
  const pad = 32;
  const minW = Math.min(shot.width, shot.width >= 1000 ? 640 : 390);
  let w = Math.min(shot.width, Math.max(minW, r.width + pad * 2));
  let x = Math.max(0, Math.min(shot.width - w, r.x + r.width / 2 - w / 2));
  let h = Math.min(Math.max(r.height + pad * 2, w * 0.35), w * 0.75);
  let y = Math.max(0, Math.min(shot.height - h, r.y - pad));
  if (r.height + pad * 2 > h) y = Math.max(0, r.y - pad);
  [w, x, h, y] = [w, x, h, y].map(Math.round);
  return `<svg class="crop" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Screenshot crop"><use href="#${shot.id}"/><rect class="hl" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="3"/></svg>`;
}

function evidenceRow(e: Evidence, shots: Map<string, Partial<Record<'desktop' | 'mobile', Shot>>>): string {
  const icon = e.type === 'source' ? ICON.file : e.type === 'console' ? ICON.term : e.type === 'network' ? ICON.net : e.type === 'metric' ? ICON.metric : ICON.page;
  const where: string[] = [];
  if (e.route) where.push(`<span class="pill">${esc(e.route)}${e.viewport ? ` <span class="dim">${e.viewport}</span>` : ''}</span>`);
  if (e.alsoOn?.length) where.push(`<span class="dim">also on ${e.alsoOn.map(esc).join(', ')}</span>`);
  if (e.file) where.push(`<code class="loc">${esc(e.file)}${e.line ? `:${e.line}` : ''}</code>`);
  if (e.selector) where.push(`<code class="sel">${esc(e.selector)}</code>`);
  const shot = e.route && e.viewport ? shots.get(e.route)?.[e.viewport] : undefined;
  return `<li class="ev">
    <span class="ev-icon">${icon}</span>
    <div class="ev-body">
      ${where.length ? `<div class="ev-where">${where.join('')}</div>` : ''}
      ${e.excerpt ? `<div class="ev-snippet">${esc(e.excerpt)}</div>` : ''}
      ${e.metric ? `<div class="ev-detail">${Object.entries(e.metric).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')}</div>` : ''}
      ${e.detail ? `<div class="ev-detail">${esc(e.detail)}</div>` : ''}
      ${crop(e, shot)}
    </div>
  </li>`;
}

export function fixPrompt(f: Finding): string {
  const ev = f.evidence
    .slice(0, 10)
    .map((e) => {
      const bits = [
        e.route && `route ${e.route}${e.viewport ? ` (${e.viewport})` : ''}${e.alsoOn?.length ? `, also on ${e.alsoOn.join(', ')}` : ''}`,
        e.file && `${e.file}${e.line ? `:${e.line}` : ''}`,
        e.selector && `selector \`${e.selector}\``,
        e.excerpt && `"${e.excerpt}"`,
        e.detail,
      ].filter(Boolean);
      return `- ${bits.join(', ')}`;
    })
    .join('\n');
  return `[${f.ruleId}] ${f.title}${f.verified ? '' : ' (design observation, use judgment)'}\n${f.description}\n${ev ? `Evidence:\n${ev}\n` : ''}Fix: ${f.recommendation}`;
}

function findingCard(f: Finding, shots: Map<string, Partial<Record<'desktop' | 'mobile', Shot>>>, open: boolean, penalty: number | undefined): string {
  return `<details class="finding" data-cat="${f.category}" data-sev="${f.severity}" id="${esc(f.id)}"${open ? ' open' : ''}>
  <summary>
    <span class="chev">${ICON.chevron}</span>
    <span class="sev sev-${f.severity}">${SEV_LABEL[f.severity]}</span>
    <span class="f-title">${esc(f.title)}</span>
    <span class="f-meta">${esc(CATEGORY_LABELS[f.category])}${f.routes?.length ? ` · ${f.routes.length} route${f.routes.length === 1 ? '' : 's'}` : ''}${f.advisory ? ' · advisory' : penalty ? ` · +${penalty}` : ''}</span>
  </summary>
  <div class="f-body">
    <p class="f-msg">${esc(f.description)}</p>
    <div class="f-fix"><span class="label">Fix</span><p>${esc(f.recommendation)}</p></div>
    <div class="f-tags">
      <span class="kind ${f.verified ? 'kind-v' : 'kind-o'}">${f.verified ? 'Verified defect' : f.advisory ? 'Model observation' : 'Design observation'}</span>
      <span>Confidence: <b>${Math.round(f.confidence * 100)}%</b></span>
      <span>Source: <b>${f.source === 'model' ? 'local model' : f.source}</b></span>
      <span>Rule: <code>${esc(f.ruleId)}</code></span>
      <label class="pick"><input type="checkbox" class="sel-box" value="${esc(f.id)}"> Add to fix prompt</label>
      <button class="btn-ghost copy-one" type="button" data-id="${esc(f.id)}">${ICON.copy}<span>Copy prompt</span></button>
    </div>
    ${f.evidence.length ? `<ul class="evidence">${f.evidence.slice(0, 4).map((e) => evidenceRow(e, shots)).join('')}</ul>` : ''}
    ${f.evidence.length > 4 ? `<details class="more"><summary>Show ${f.evidence.length - 4} more</summary><ul class="evidence">${f.evidence.slice(4).map((e) => evidenceRow(e, shots)).join('')}</ul></details>` : ''}
  </div>
</details>`;
}

const CSS = `
:root{--bg:#f6f5f1;--surface:#fffefb;--ink:#1b1b19;--muted:#66655f;--faint:#9a998f;--rule:#e3e1d9;--accent:#c2410c;--hl:#e8590c;
--crit:#b42318;--high:#c4320a;--med:#a15c07;--low:#4b5563;--info:#6b7280;--bar:#1b1b19;--track:#e9e7df;--code:#f0eee7}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141413;--surface:#1c1c1a;--ink:#ecebe6;--muted:#a3a29a;--faint:#76756e;--rule:#2e2d2a;--accent:#fb923c;--hl:#fb923c;
--crit:#f97066;--high:#fb8c5a;--med:#f5b84a;--low:#a8b0bd;--info:#9aa1ad;--bar:#ecebe6;--track:#2e2d2a;--code:#242421}}
:root[data-theme="dark"]{--bg:#141413;--surface:#1c1c1a;--ink:#ecebe6;--muted:#a3a29a;--faint:#76756e;--rule:#2e2d2a;--accent:#fb923c;--hl:#fb923c;
--crit:#f97066;--high:#fb8c5a;--med:#f5b84a;--low:#a8b0bd;--info:#9aa1ad;--bar:#ecebe6;--track:#2e2d2a;--code:#242421}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.wrap{max-width:1040px;margin:0 auto;padding:40px 24px 120px}
header.top{display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:1px solid var(--rule);padding-bottom:14px;flex-wrap:wrap}
.brand{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;letter-spacing:-.02em;font-size:17px}
.brand span{color:var(--accent)}
.target{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.hero{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:48px;padding:40px 0 32px;border-bottom:1px solid var(--rule)}
.score{font-size:96px;line-height:.9;font-weight:700;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
.score small{font-size:20px;color:var(--faint);font-weight:500;letter-spacing:0}
.eyebrow{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:8px}
.grade{margin-top:12px;font-size:14px;color:var(--muted);max-width:30ch}
.cat .w{color:var(--faint);font-size:12px;font-variant-numeric:tabular-nums}
.limits{margin:12px 0 0;padding:12px 16px 12px 32px;background:var(--surface);border:1px solid var(--rule);border-radius:8px;color:var(--muted);font-size:14px}
.limits li{margin:2px 0}
.kind{font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid currentColor}
.kind-v{color:var(--high)}.kind-o{color:var(--muted)}
.summary{color:var(--muted);margin-top:8px;max-width:30ch}
.cats{display:grid;gap:10px;align-content:start;grid-template-columns:auto}
.cats .cat{grid-template-columns:230px 1fr 44px}
.cat{display:grid;grid-template-columns:minmax(150px,auto) 1fr 44px;align-items:center;gap:14px;font-size:14px}
.cat .track{height:6px;background:var(--track);border-radius:3px;overflow:hidden}
.cat .fill{height:100%;background:var(--bar);border-radius:3px}
.cat .num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.cat.na{color:var(--faint)} .cat.na .num{font-weight:400}
.cat-btn{all:unset;cursor:pointer;border-radius:4px}
.cat-btn:hover{text-decoration:underline;text-underline-offset:3px}
.cat-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin:44px 0 14px}
.coverage{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:8px;overflow:hidden}
.coverage div{background:var(--surface);padding:12px 14px}
.coverage b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.coverage span{color:var(--muted);font-size:13px}
.note{margin-top:12px;padding:10px 14px;border-left:3px solid var(--accent);background:var(--surface);color:var(--ink);font-size:14px;border-radius:0 6px 6px 0}
.first{counter-reset:n;list-style:none;padding:0;margin:0;border-top:1px solid var(--rule)}
.first li{counter-increment:n;display:grid;grid-template-columns:28px 80px 1fr auto;gap:12px;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--rule)}
.first li::before{content:counter(n);color:var(--faint);font-variant-numeric:tabular-nums}
.first a{color:inherit;text-decoration:none;font-weight:500}
.first a:hover{text-decoration:underline;text-underline-offset:3px}
.first .cat-name{color:var(--muted);font-size:13px}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.chip{border:1px solid var(--rule);background:var(--surface);color:var(--ink);padding:5px 11px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.chip:focus-visible,.btn-ghost:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.finding{background:var(--surface);border:1px solid var(--rule);border-radius:8px;margin-bottom:8px}
.finding summary{list-style:none;display:grid;grid-template-columns:16px 76px 1fr auto;gap:12px;align-items:center;padding:13px 16px;cursor:pointer}
.finding summary::-webkit-details-marker{display:none}
.chev svg{width:14px;height:14px;fill:none;stroke:var(--faint);stroke-width:1.6;transition:transform .15s}
.finding[open] .chev svg{transform:rotate(90deg)}
.f-title{font-weight:600}
.f-meta{color:var(--muted);font-size:13px;white-space:nowrap}
.sev{font-size:12px;font-weight:600;letter-spacing:.02em}
.sev::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:currentColor;vertical-align:1px}
.sev-critical{color:var(--crit)}.sev-high{color:var(--high)}.sev-medium{color:var(--med)}.sev-low{color:var(--low)}.sev-info{color:var(--info)}
.f-body{padding:0 16px 16px 44px}
.f-msg{margin:0 0 12px;max-width:75ch}
.f-fix{display:grid;grid-template-columns:44px 1fr;gap:8px;padding:10px 12px;background:var(--code);border-radius:6px;max-width:80ch}
.f-fix p{margin:0}
.label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);padding-top:2px}
.f-tags{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin:12px 0;color:var(--muted);font-size:13px}
.f-tags b{color:var(--ink);font-weight:600}
.pick{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.btn-ghost{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--rule);background:transparent;color:var(--ink);border-radius:6px;padding:4px 10px;font:inherit;font-size:13px;cursor:pointer}
.btn-ghost:hover{border-color:var(--ink)}
.btn-ghost svg,.ev-icon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.evidence{list-style:none;padding:0;margin:0;border-top:1px solid var(--rule)}
.ev{display:grid;grid-template-columns:22px 1fr;gap:8px;padding:10px 0;border-bottom:1px solid var(--rule)}
.ev:last-child{border-bottom:0}
.ev-icon{color:var(--faint);padding-top:2px}
.ev-where{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pill{font-size:12.5px;background:var(--code);padding:1px 7px;border-radius:4px}
.dim{color:var(--faint)}
.loc{color:var(--accent)}
.sel{color:var(--muted);overflow-wrap:anywhere}
.ev-snippet{margin-top:4px;font-size:14px;overflow-wrap:anywhere}
.ev-detail{margin-top:2px;color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.crop{display:block;margin-top:8px;width:100%;max-width:560px;height:auto;border:1px solid var(--rule);border-radius:6px;background:var(--code)}
.crop .hl{fill:none;stroke:var(--hl);stroke-width:3;vector-effect:non-scaling-stroke}
.pages{display:grid;gap:28px}
.pg{display:grid;grid-template-columns:1fr 150px;gap:14px;align-items:start}
.pg-head{grid-column:1/-1;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.pg-head b{font-weight:600}
.pg svg.full{width:100%;height:auto;max-height:520px;border:1px solid var(--rule);border-radius:6px;display:block;background:var(--code)}
.pg .frame{max-height:520px;overflow:hidden;border-radius:6px}
.err{color:var(--crit);font-size:13px}
.method{color:var(--muted);font-size:14px;max-width:75ch}
.method code{background:var(--code);padding:1px 5px;border-radius:4px}
.tray{position:fixed;left:50%;bottom:20px;transform:translateX(-50%) translateY(150%);background:var(--ink);color:var(--bg);border-radius:10px;padding:10px 12px 10px 18px;display:flex;gap:14px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.18);transition:transform .2s;font-size:14px;max-width:calc(100% - 32px)}
.tray{visibility:hidden}.tray.show{transform:translateX(-50%) translateY(0);visibility:visible}
.finding .more summary{display:block;cursor:pointer;color:var(--muted);font-size:13px;padding:10px 0;list-style:none}
.finding .more summary:hover{color:var(--ink)}
.tray button{border:0;background:var(--bg);color:var(--ink);border-radius:6px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.empty{padding:24px;text-align:center;color:var(--muted);background:var(--surface);border:1px dashed var(--rule);border-radius:8px}
.defs{position:absolute;width:0;height:0;overflow:hidden}
@media (max-width:720px){.wrap{padding:24px 16px 120px}.hero{grid-template-columns:1fr;gap:28px}.score{font-size:72px}.cats .cat{grid-template-columns:140px 1fr 36px}
.finding summary{grid-template-columns:14px 1fr;row-gap:2px}.finding summary .f-title{grid-column:2}.finding summary .f-meta{grid-column:2;white-space:normal}.finding summary .sev{grid-column:2}
.f-body{padding:0 14px 14px}.first li{grid-template-columns:24px 1fr;}.first li .sev,.first li .cat-name{grid-column:2}.pg{grid-template-columns:1fr 96px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const JS = `
const prompts = JSON.parse(document.getElementById('prompts').textContent);
const header = 'Fix the following UI issues reported by samey. Make focused changes, keep unrelated code as is, and re-run samey afterwards to verify.\\n\\n';
async function copy(text, btn){
  try { await navigator.clipboard.writeText(text); }
  catch { const t=document.createElement('textarea'); t.value=text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  if(btn){ const s=btn.querySelector('span')||btn; const o=s.textContent; s.textContent='Copied'; setTimeout(()=>s.textContent=o,1400); }
}
document.querySelectorAll('.copy-one').forEach(b=>b.addEventListener('click',()=>copy(header+prompts[b.dataset.id],b)));
const tray=document.getElementById('tray'), count=document.getElementById('tray-count');
function sync(){ const n=document.querySelectorAll('.sel-box:checked').length; count.textContent=n+' selected'; tray.classList.toggle('show',n>0); }
document.querySelectorAll('.sel-box').forEach(c=>c.addEventListener('change',sync));
document.getElementById('tray-copy').addEventListener('click',e=>{
  const ids=[...document.querySelectorAll('.sel-box:checked')].map(c=>c.value);
  copy(header+ids.map((id,i)=>(i+1)+'. '+prompts[id]).join('\\n\\n'),e.currentTarget);
});
document.getElementById('tray-clear').addEventListener('click',()=>{document.querySelectorAll('.sel-box:checked').forEach(c=>c.checked=false);sync();});
const state={cat:'all',sev:'all'};
function apply(){
  let shown=0;
  document.querySelectorAll('.finding').forEach(f=>{
    const sevOk = state.sev==='all' || (state.sev==='important' ? ['critical','high'].includes(f.dataset.sev) : f.dataset.sev===state.sev);
    const ok=(state.cat==='all'||f.dataset.cat===state.cat)&&sevOk;
    f.hidden=!ok; if(ok) shown++;
  });
  document.getElementById('none').hidden=shown>0;
}
document.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click',()=>{
  const k=ch.dataset.kind; state[k]=ch.dataset.val;
  document.querySelectorAll('.chip[data-kind="'+k+'"]').forEach(o=>o.setAttribute('aria-pressed',String(o===ch)));
  apply();
}));
document.querySelectorAll('.cat-btn').forEach(b=>b.addEventListener('click',()=>{
  const chip=document.querySelector('.chip[data-kind="cat"][data-val="'+b.dataset.cat+'"]'); if(chip){chip.click(); document.getElementById('findings').scrollIntoView({behavior:'smooth'});}
}));
`;

export function renderHtml(report: AuditReport, outDir: string): string {
  const { defs, byPage } = loadShots(report, outDir);
  const f = report.findings;
  const scored = f.filter((x) => !x.advisory);
  const bySev = (s: Severity) => scored.filter((x) => x.severity === s).length;
  // Show local paths relative to home so a shared report does not reveal the account name.
  const home = os.homedir();
  const local = report.target.path && home && report.target.path.startsWith(home) ? '~' + report.target.path.slice(home.length) : report.target.path;
  const target = local ?? report.target.url ?? '';
  const prompts = Object.fromEntries(f.map((x) => [x.id, fixPrompt(x)]));
  const cov = report.coverage;

  const summary =
    report.score === null
      ? 'Not enough was measured to score this site.'
      : `${scored.length} finding${scored.length === 1 ? '' : 's'}: ${bySev('critical') + bySev('high')} high priority, ${bySev('medium')} medium, ${bySev('low')} low.`;

  const cats = report.categories
    .map((c) => {
      const label = esc(CATEGORY_LABELS[c.category]);
      const weight = `<span class="w">${Math.round(c.weight * 100)}%</span>`;
      if (c.score === null) return `<div class="cat na"><span>${label} ${weight}</span><div class="track"></div><span class="num">n/a</span></div>`;
      return `<div class="cat"><button class="cat-btn" data-cat="${c.category}" type="button">${label} ${weight}</button><div class="track"><div class="fill" style="width:${c.score}%"></div></div><span class="num">${Math.round(c.score)}</span></div>`;
    })
    .join('');
  const penalties = new Map(report.categories.flatMap((c) => c.deductions.map((d) => [d.findingId, d.penalty] as const)));

  // Not configuring a model is the normal case; only surface model notes when one was asked for.
  const notes = [...cov.limitations];
  if (cov.model.note && cov.model.name) notes.push(`Local model: ${cov.model.note}.`);

  const fixFirst = scored.slice(0, 5);
  const usedCats = [...new Set(f.map((x) => x.category))];

  const pages = report.pages
    .map((p) => {
      const s = byPage.get(p.path) ?? {};
      const d = s.desktop;
      const m = s.mobile;
      return `<div class="pg">
        <div class="pg-head"><b>${esc(p.path)}</b><span class="dim">${esc(p.title ?? '')}</span>${p.status && p.status >= 400 ? `<span class="err">HTTP ${p.status}</span>` : ''}${p.error ? `<span class="err">${esc(p.error)}</span>` : ''}</div>
        ${d ? `<div class="frame"><svg class="full" viewBox="0 0 ${d.width} ${Math.min(d.height, d.width * 1.6)}" preserveAspectRatio="xMidYMin slice" role="img" aria-label="Desktop screenshot of ${esc(p.path)}"><use href="#${d.id}"/></svg></div>` : '<div></div>'}
        ${m ? `<div class="frame"><svg class="full" viewBox="0 0 ${m.width} ${Math.min(m.height, m.width * 3.5)}" preserveAspectRatio="xMidYMin slice" role="img" aria-label="Mobile screenshot of ${esc(p.path)}"><use href="#${m.id}"/></svg></div>` : ''}
      </div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>samey report${report.repo?.name ? ` · ${esc(report.repo.name)}` : ''}</title>
<style>${CSS}</style>
</head>
<body>
${defs}
<div class="wrap">
  <header class="top">
    <div class="brand">same<span>y</span></div>
    <div class="target">${esc(target)} · ${esc(new Date(report.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</div>
  </header>

  <section class="hero">
    <div>
      <div class="eyebrow">Slop score</div>
      <div class="score">${report.score === null ? '–' : Math.round(report.score)}<small>/100</small></div>
      <div class="grade">Lower is better. 0 means no slop indicators were found.</div>
      <p class="summary">${esc(summary)}</p>
    </div>
    <div class="cats">${cats}</div>
  </section>

  <h2>Coverage</h2>
  <div class="coverage">
    <div><b>${cov.pagesAudited}</b><span>pages rendered${cov.pagesFailed ? `, ${cov.pagesFailed} failed` : ''}</span></div>
    <div><b>${report.repo ? report.repo.fileCount : '–'}</b><span>source files scanned${report.repo?.truncated ? ' (limit hit)' : ''}</span></div>
    <div><b>${cov.rendered ? '2' : '0'}</b><span>viewports (1440px, 390px)</span></div>
    <div><b>${cov.interactions && cov.rendered ? 'on' : 'off'}</b><span>safe click testing</span></div>
    <div><b>${cov.model.enabled ? esc(cov.model.name) : 'off'}</b><span>local model review</span></div>
  </div>
  ${notes.length ? `<ul class="limits">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}

  ${fixFirst.length ? `<h2>Fix first</h2><ol class="first">${fixFirst.map((x) => `<li><span class="sev sev-${x.severity}">${SEV_LABEL[x.severity]}</span><a href="#${esc(x.id)}" data-open="${esc(x.id)}">${esc(x.title)}</a><span class="cat-name">${esc(CATEGORY_LABELS[x.category])}</span></li>`).join('')}</ol>` : ''}

  <h2 id="findings">Findings</h2>
  ${
    f.length
      ? `<div class="filters" role="toolbar" aria-label="Filter findings">
    <button class="chip" data-kind="cat" data-val="all" aria-pressed="true">All categories</button>
    ${usedCats.map((c) => `<button class="chip" data-kind="cat" data-val="${c}" aria-pressed="false">${esc(CATEGORY_LABELS[c])}</button>`).join('')}
  </div>
  <div class="filters" role="toolbar" aria-label="Filter by severity">
    <button class="chip" data-kind="sev" data-val="all" aria-pressed="true">Any severity</button>
    <button class="chip" data-kind="sev" data-val="important" aria-pressed="false">Critical and high</button>
    <button class="chip" data-kind="sev" data-val="medium" aria-pressed="false">Medium</button>
    <button class="chip" data-kind="sev" data-val="low" aria-pressed="false">Low</button>
  </div>
  ${f.map((x, i) => findingCard(x, byPage, i < 2, penalties.get(x.id))).join('')}`
      : ''
  }
  <div class="empty" id="none" ${f.length ? 'hidden' : ''}>No findings${f.length ? ' match these filters' : ''}.</div>

  ${pages ? `<h2>Pages</h2><div class="pages">${pages}</div>` : ''}

  <h2>How the score works</h2>
  <div class="method">
    <p>The score counts detected quality problems; it is not a probability that AI wrote the site. Each finding adds a penalty <code>p = s × c × w</code>: severity <code>s</code> (low 0.25, medium 0.5, high 0.75, critical 1), confidence <code>c</code> (0 to 1), and a per-rule weight <code>w</code> (default ${SCORING.defaultPenalty}). Penalties in a category add up to <code>P</code>, and the category score is <code>100 × (1 − e<sup>−P/${SCORING.saturation}</sup>)</code>, so many small findings cannot push it past 100. The overall score is the weighted average of the measured categories; categories that could not be measured are left out rather than counted as clean.</p>
    <p>Identical evidence on several pages, such as a shared footer, counts once. Verified defects are measured; design observations are heuristics worth a human look. Local model observations are advisory and never change the score. The weights are starting points, not calibrated values.</p>
    <p class="dim">samey ${esc(report.tool.version)} · scoring ${esc(report.versions.scoring)} · scan ${esc(report.scanId.slice(0, 8))} · ${(report.durationMs / 1000).toFixed(1)}s</p>
  </div>
</div>

<div class="tray" id="tray" role="region" aria-label="Selected findings">
  <span id="tray-count">0 selected</span>
  <button id="tray-copy" type="button"><span>Copy fix prompt</span></button>
  <button id="tray-clear" type="button">Clear</button>
</div>
<script type="application/json" id="prompts">${JSON.stringify(prompts).replace(/</g, '\\u003c')}</script>
<script>${JS}
document.querySelectorAll('[data-open]').forEach(a=>a.addEventListener('click',()=>{const d=document.getElementById(a.dataset.open); if(d) d.open=true;}));
</script>
</body>
</html>`;
}
