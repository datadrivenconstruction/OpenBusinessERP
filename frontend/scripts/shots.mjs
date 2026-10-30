// Screenshots of the sign-in and onboarding flow for visual review.
// Usage: node scripts/shots.mjs <baseUrl> <email> <password> <outDir>
//        SHOTS_DEMO=1|name,name node scripts/shots.mjs http://localhost:8000 '' '' <outDir>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4173', email, password, out = 'shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (name) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
};

await page.goto(`${base}/login`, { waitUntil: 'load', timeout: 90000 });
await shot('01-login');

// SHOTS_DEMO=1: sign in with the "Admin" demo button and capture README screens (2x, light).
if (process.env.SHOTS_DEMO) {
  await page.close();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.addInitScript(() => { try { localStorage.setItem('oe_theme', 'light'); } catch {} });
  const p = await ctx.newPage();
  const dismiss = async () => {
    await p.keyboard.press('Escape').catch(() => {});
    for (const re of [/skip tour/i, /^skip$/i, /not now/i, /maybe later/i, /no thanks/i, /dismiss/i, /^close$/i]) {
      const b = p.getByRole('button', { name: re });
      for (const el of await b.all()) await el.click({ timeout: 1000 }).catch(() => {});
    }
  };
  await p.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await p.getByRole('button', { name: /Admin/ }).first().click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  const only = process.env.SHOTS_DEMO.split(',').filter((x) => x !== '1');
  const list = [['dashboard', '/'], ['sales', '/sales'], ['invoice', 'INVOICE'], ['crm', '/crm'], ['products', '/items'], ['purchasing', '/purchasing'], ['banking', '/banking'], ['receivables', '/receivables'], ['accounting', '/accounting'], ['reports', '/accounting/reports'], ['appointments', '/appointments'], ['booking', 'BOOKING'], ['import', '/import'], ['settings', '/settings'], ['chat', '/chat']];
  for (let [name, path] of list) {
    if (only.length && !only.includes(name)) continue;
    if (path === 'INVOICE') {
      const id = await p.evaluate(async () => {
        const tok = localStorage.getItem('oe_access_token') || sessionStorage.getItem('oe_access_token') || '';
        const r = await fetch('/api/v1/sales/invoices/?limit=100', { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
        if (!r.ok) return 'ERR' + r.status;
        const rows = (await r.json()).filter((d) => d.status === 'paid' && Number(d.tax_total) > 0 && Number(d.gross_total) > 3000);
        const pick = rows.sort((x, y) => Number(x.gross_total) - Number(y.gross_total))[Math.floor(rows.length / 2)];
        return pick ? pick.id : null;
      });
      await p.goto(`${base}/sales/invoices/${id}`, { waitUntil: 'networkidle' });
      await p.locator('table input, table td, [data-testid]').first().waitFor({ timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(3000); await dismiss();
      await p.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name, p.url()); continue;
    }
    if (path === 'BOOKING') {
      const slug = await p.evaluate(async () => {
        const tok = localStorage.getItem('oe_access_token') || sessionStorage.getItem('oe_access_token') || '';
        const r = await fetch('/api/v1/appointments/settings/', { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
        return r.ok ? (await r.json()).slug : null;
      });
      path = `/book/${process.env.SHOTS_SLUG || slug}`;
    }
    await p.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    if (name === 'appointments') {
      await p.getByRole('tab', { name: /^List$/ }).or(p.getByRole('button', { name: /^List$/ })).first().click().catch(() => {});
      await p.waitForTimeout(2500);
    }
    if (name === 'booking') { await p.getByRole('button', { name: /consultation/i }).or(p.getByText(/Product consultation/i)).first().click().catch(() => {}); await p.waitForTimeout(2500); }
    await p.waitForTimeout(Number(process.env.SHOTS_WAIT || 3500));
    await dismiss(); await p.waitForTimeout(600);
    if (name === 'reports') { await p.locator('button:has-text("Profit and loss"), [role=tab]:has-text("Profit and loss")').last().click().catch(() => {}); await p.waitForTimeout(2500); }
    await p.screenshot({ path: `${out}/${name}.png` });
    console.log('shot', name, path);
  }
  await browser.close();
  process.exit(0);
}

if (email && password) {
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  if (process.env.SHOTS_APP) {
    for (const [name, path] of [['10-home', '/'], ['18-dashboard', '/dashboard'], ['19-settings', '/settings?tab=advanced'], ['11-sales', '/sales'], ['12-quote-new', '/sales/quotes/new'], ['13-crm', '/crm'], ['14-items', '/items'], ['15-accounting', '/accounting'], ['16-reports', '/accounting/reports'], ['17-journal', '/accounting/journal'], ['20-purchasing', '/purchasing'], ['21-banking', '/banking'], ['22-receivables', '/receivables'], ['23-import', '/import'], ['24-appointments', '/appointments'], ['25-po-new', '/purchasing/orders/new'], ['26-cases', '/cases'], ['27-about', '/about'], ['28-chat', '/chat']]) {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      await shot(name);
    }
    await browser.close();
    process.exit(0);
  }
  await page.goto(`${base}/onboarding`, { waitUntil: 'networkidle' });
  await shot('02-language');
  await page.getByRole('button', { name: /get started/i }).click();
  await shot('03-company');
  await page.getByLabel(/company name/i).fill('Kestrelmark Handel GmbH');
  await page.getByRole('button', { name: /continue/i }).click();
  await shot('04-industry');
  await page.getByRole('radio', { name: /trade/i }).click();
  await shot('04b-industry-selected');
  await page.getByRole('button', { name: /continue/i }).click();
  await shot('05-apps');
  await page.getByRole('button', { name: /continue with/i }).click();
  await shot('06-launch');
  await page.getByRole('button', { name: /open my workspace/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/onboarding'), { timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot('07-home');
}
await browser.close();
