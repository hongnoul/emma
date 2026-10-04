// Real-browser acceptance pass over the ported frontend pages (home, disease,
// research, paper, patient). Needs a running backend (:8000) and frontend.
// Usage: npm i playwright-core && E2E_BASE=http://localhost:3000 node scripts/frontend-e2e.mjs
import { chromium } from 'playwright-core';

const exe = [
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
let browser;
for (const e of exe) {
  try { browser = await chromium.launch({ executablePath: e, headless: true }); break; } catch {}
}
if (!browser) { console.log('FAIL: no browser'); process.exit(1); }

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const base = process.env.E2E_BASE ?? 'http://localhost:3000';
const results = [];
const check = (name, ok, detail='') => { results.push([ok?'PASS':'FAIL', name, detail]); console.log(ok?'PASS':'FAIL', '—', name, detail?'('+detail+')':''); };

// R1: Home page — ported hero layout + live search + result links
await page.goto(base + '/?q=lysosomal', { waitUntil: 'networkidle' });
check('home: hero headline', await page.locator('h1:has-text("Every rare-disease link")').count() === 1);
check('home: eyebrow pipeline', (await page.textContent('body')).includes('Disease → gene → variant'));
await page.waitForSelector('ul li a[href^="/disease/"]', { timeout: 15000 });
const firstResult = await page.textContent('ul li a[href^="/disease/"]');
check('home: live search results render', !!firstResult, firstResult.slice(0,50));
// example chip triggers a new search
await page.click('button:has-text("seizures")');
await page.waitForFunction(() => location.search.includes('seizures'), { timeout: 10000 });
check('home: example chip updates URL + search', true);

// R2: Disease page — ported layout, genes table with provenance, related, research links
await page.goto(base + '/disease/DEMO-DIS-001', { waitUntil: 'networkidle' });
await page.waitForSelector('h1:has-text("Demo Lysosomal")', { timeout: 20000 });
check('disease: header renders', true);
check('disease: genes table', await page.locator('table tbody tr').count() >= 1);
check('disease: provenance badge in table', (await page.locator('table').textContent()).includes('curated'));
check('disease: What causes it section', await page.locator('h2:has-text("What causes it")').count() === 1);
check('disease: Basic research button', await page.locator('a[href="/research/DEMO-DIS-001"]').count() === 1);
check('disease: related diseases cards', await page.locator('text=Why are these connected?').count() >= 1);
check('disease: phenotype chips', await page.locator('h2:has-text("Phenotypes")').count() === 1);

// R3: Research page — live PubMed classification, filter chips interaction
await page.goto(base + '/research/DEMO-DIS-001', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1:has-text("Basic research")', { timeout: 90000 });
const total = await page.locator('p:has-text("PubMed matches")').textContent();
check('research: live PubMed total', /[\d,]+ PubMed matches/.test(total), total.trim().slice(0,80));
const allChip = await page.locator('button:has-text("All ·")').textContent();
check('research: filter chips with counts', /All · \d+/.test(allChip), allChip);
const paperCountAll = await page.locator('ul li a[href^="/paper/"]').count();
check('research: paper list renders', paperCountAll > 0, `${paperCountAll} papers`);
// click a model filter and confirm the list actually narrows
const chips = page.locator('button[aria-pressed]');
const chipTexts = await chips.allTextContents();
const narrow = chipTexts.find(t => !t.startsWith('All') && parseInt(t.split('·')[1]) < paperCountAll);
if (narrow) {
  await page.click(`button:has-text("${narrow.split('·')[0].trim()}")`);
  await page.waitForTimeout(300);
  const after = await page.locator('ul li a[href^="/paper/"]').count();
  check('research: model filter narrows list', after < paperCountAll && after > 0, `${paperCountAll} -> ${after} (${narrow.trim()})`);
}
// classification evidence disclosure opens
const details = page.locator('details summary:has-text("Classification evidence")').first();
if (await details.count()) {
  await details.click();
  check('research: classification evidence opens', (await page.locator('details[open] dt').count()) > 0);
}

// R4: Paper reader — click through from research list to full text / fallback
await page.click('button:has-text("All ·")');
await page.waitForTimeout(200);
const href = await page.locator('ul li a[href^="/paper/"]').first().getAttribute('href');
await page.goto(base + href, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('p:has-text("PMID")', { timeout: 60000 });
const body = await page.textContent('body');
const hasFT = await page.locator('article section').count();
const hasFallback = body.includes("isn't in the open-access collection") || body.includes("couldn't be loaded");
check('paper: renders full text or honest fallback', hasFT > 0 || hasFallback, hasFT ? `${hasFT} sections` : 'non-OA fallback');
check('paper: PubMed external link', await page.locator('a[href*="pubmed.ncbi"]').count() === 1);

// R5: Patient app — hydration, tab switching, live AI chat against backend, consent flow
await page.goto(base + '/patient', { waitUntil: 'networkidle' });
await page.waitForSelector('text=You are not a symptom list', { timeout: 20000 });
check('patient: journey tab renders hydrated', true);
check('patient: phone frame + tab bar', await page.locator('nav button').count() === 5);
// toast appears at 2.5s
await page.waitForSelector('text=Good morning Adira', { timeout: 8000 });
check('patient: daily-support toast fires', true);
// switch to AI tab, send live query
await page.click('nav button:has-text("AI")');
await page.waitForSelector('text=Rarepath AI', { timeout: 5000 });
check('patient: chat tab renders', true);
await page.fill('form input', 'lysosomal');
await page.press('form input', 'Enter');
await page.waitForSelector('text=Emmatics · live', { timeout: 20000 });
const aiMsg = await page.locator('div.rise >> text=/I found/').last().textContent();
check('patient: live atlas chat reply', aiMsg.includes('Demo Lysosomal Storage Disorder A') && aiMsg.includes('LYSA1'), aiMsg.slice(0,90));
// canned fallback
await page.click('button:has-text("I missed a dose")');
await page.waitForSelector("text=one missed dose doesn't undo", { timeout: 10000 });
check('patient: canned reply fallback', true);
// community tab connect toggle
await page.click('nav button:has-text("Community")');
await page.click('button:has-text("Connect") >> nth=0');
check('patient: connect toggle', (await page.textContent('body')).includes('✓ Connected'));
// research tab: consent gate blocks until checkbox, then check-in flow
await page.click('nav button:has-text("Research")');
await page.waitForSelector('text=Informed consent', { timeout: 5000 });
check('patient: consent gate shown first', true);
const agreeBtn = page.locator('button:has-text("Agree & continue")');
check('patient: agree disabled before checkbox', await agreeBtn.isDisabled());
await page.check('input[type="checkbox"]');
check('patient: agree enabled after checkbox', await agreeBtn.isEnabled());
await agreeBtn.click();
await page.waitForSelector('text=Weekly AI check-in', { timeout: 5000 });
check('patient: check-in appears after consent', true);
await page.click('button:has-text("Submit & share with research")');
await page.waitForSelector('text=Thank you, Adira', { timeout: 5000 });
check('patient: check-in submit confirmation', true);
// live research feed (backend evidence)
const feedOk = await page.waitForSelector('text=Emmatics · live', { timeout: 20000 }).then(() => true).catch(() => false);
const feedItems = await page.locator('li.glass-soft').count();
check('patient: live research feed from backend', feedOk, `${feedItems} feed items`);

// R6: Monochrome compliance — computed colors on new pages are achromatic
for (const path of ['/', '/disease/DEMO-DIS-001', '/patient']) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const chromatic = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('main *, [class*=glass]')) {
      if (el.closest('canvas') || el.tagName === 'CANVAS') continue;
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const m = cs[prop].match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          if (Math.max(r,g,b) - Math.min(r,g,b) > 12) { bad.push(`${el.tagName}.${el.className?.toString().slice(0,30)} ${prop}=${cs[prop]}`); break; }
        }
      }
      if (bad.length > 3) break;
    }
    return bad;
  });
  check(`mono: ${path} achromatic`, chromatic.length === 0, chromatic.slice(0,2).join(' | '));
}

for (const [s, n, d] of results) console.log(s, '—', n, d ? `(${d})` : '');
const fails = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
