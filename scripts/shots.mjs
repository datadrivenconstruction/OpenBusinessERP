// README screenshots and the sales-flow demo recording.
// Usage (playwright is resolved from frontend/node_modules):
//   node ../scripts/shots.mjs <baseUrl> [name ...]      PNGs into docs/images
//   node ../scripts/shots.mjs <baseUrl> --flow <outDir> <quoteId>  WebM of quote→paid
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(ROOT, 'frontend', 'package.json'))('playwright');
const OUT = path.join(ROOT, 'docs', 'images');
const base = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const args = process.argv.slice(3);

export const SHOTS = {
  dashboard: '/',
  sales: '/sales',
  crm: '/crm',
  products: '/items',
  purchasing: '/purchasing',
  banking: '/banking',
  receivables: '/receivables',
  accounting: '/accounting',
  reports: '/accounting/reports?tab=pnl',
  settings: '/settings',
  recurring: '/sales/recurring',
  inventory: '/inventory',
  export: '/accounting/reports?tab=export',
};

async function login(page) {
  await page.goto(`${base}/login`);
  await page.getByText('Administrator', { exact: false }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

async function shots(names) {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  await login(page);
  for (const n of names) {
    await page.goto(base + SHOTS[n]);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `${n}.png`) });
    console.log('shot', n);
  }
  await browser.close();
}

async function click(page, name) {
  const b = page.getByRole('button', { name, exact: true }).last();
  await b.waitFor({ timeout: 20000 });
  await b.hover();
  await page.waitForTimeout(700);
  await b.click();
  await settle(page);
}

// Runs a document action: the primary button if shown, else the "More actions" menu.
async function act(page, name) {
  const btn = page.getByRole('button', { name, exact: true });
  await btn.waitFor({ timeout: 4000 }).catch(() => {});
  if (await btn.count()) return click(page, name);
  await click(page, 'More actions');
  const item = page.getByRole('menuitem', { name, exact: true });
  await item.hover();
  await page.waitForTimeout(600);
  await item.click();
  await settle(page);
}

// Quote → order → invoice → paid, driven through the document page.
async function runFlow(page) {
  await page.waitForTimeout(1500);
  await act(page, 'Mark sent');
  await act(page, 'Accepted');
  await act(page, 'Convert to order');
  await click(page, 'Convert to order');
  await page.waitForTimeout(1200);
  await act(page, 'Confirm');
  await act(page, 'Create invoice');
  await click(page, 'Create invoice');
  await page.waitForTimeout(1200);
  await act(page, /^Issue/);
  await page.waitForTimeout(800);
  await act(page, 'Record payment');
  await page.waitForTimeout(800);
  if (await page.getByRole('dialog').count()) await click(page, 'Record');
  await page.waitForTimeout(3000);
}

async function flow(outDir) {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${base}/sales/quotes/${args[2]}`);
  await settle(page);
  await page.addStyleTag({ content: '.oe-dock-aware{display:none!important}' });
  // Frame sequence with wall-clock timestamps; ffmpeg turns it into the GIF.
  fs.mkdirSync(outDir, { recursive: true });
  let rec = true, n = 0;
  const t0 = Date.now(), times = [];
  const loop = (async () => {
    while (rec) {
      const f = `f${String(n).padStart(4, '0')}.png`;
      await page.screenshot({ path: path.join(outDir, f) }).then(() => { times.push([f, Date.now() - t0]); n++; }, () => {});
      await page.waitForTimeout(120).catch(() => {});
    }
  })();
  await runFlow(page);
  rec = false;
  await loop;
  const lines = times.map(([f, t], i) => `file '${f}'\nduration ${(((times[i + 1]?.[1] ?? t + 1500) - t) / 1000).toFixed(3)}`);
  fs.writeFileSync(path.join(outDir, 'frames.txt'), lines.join('\n') + `\nfile '${times.at(-1)[0]}'\n`);
  await runFlow(page, base);
  await ctx.close();
  await browser.close();
}

if (args[0] === '--flow') await flow(args[1] || 'C:/tmp/obe_flow');
else await shots(args.length ? args : Object.keys(SHOTS));
