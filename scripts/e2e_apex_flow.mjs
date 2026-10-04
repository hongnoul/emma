#!/usr/bin/env node
// E2E of the apex persona-first flow over CDP:
//  1. bubbles render ABOVE the search bar in document flow
//  2. clicking the Physician bubble pins it (aria-pressed, no navigation)
//     and focuses the search input
//  3. typing a query + Enter lands on /physician?q=... with the node
//     section's search input pre-seeded and results resolving
//  4. clicking the pinned bubble navigates directly
//  5. Escape ladder: clears query -> unpins persona -> blurs input
// No test framework. Usage: node scripts/e2e_apex_flow.mjs [browser-binary]
import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import http from "node:http";

const CANDIDATES = [
  process.argv[2],
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const BIN = CANDIDATES.find((p) => existsSync(p));
if (!BIN) { console.error("no Chromium-based browser found"); process.exit(2); }

// Per-process port: back-to-back runs otherwise race the previous browser's
// shutdown and attach to its dying CDP endpoint.
const PORT = 9300 + (process.pid % 500);
const BASE = "http://localhost:3000";
const PROFILE = `/tmp/apex-flow-e2e-${process.pid}`;

const proc = execFile(BIN, [
  "--headless", "--remote-debugging-port=" + PORT,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", `--user-data-dir=${PROFILE}`, "--window-size=1400,1000",
  BASE + "/",
]);
proc.on("error", (e) => { console.error(e); process.exit(2); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsonGet = (path) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path }, (r) => {
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(JSON.parse(b)));
  }).on("error", rej);
});

async function connect(match) {
  for (let i = 0; i < 40; i++) {
    try {
      const tabs = await jsonGet("/json");
      const tab = tabs.find((t) => t.type === "page" && t.url.includes(match));
      if (tab) return tab.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error("tab not found: " + match);
}

let msgId = 0;
function makeWs(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ready = new Promise((r) => (ws.onopen = r));
  return { ws, send, ready };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

async function evalJs(send, expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function waitFor(send, expression, timeoutMs = 10000, interval = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(send, expression);
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

try {
  const wsUrl = await connect(BASE);
  const { send, ready } = makeWs(wsUrl);
  await ready;
  await send("Runtime.enable");
  await send("Page.enable");

  // -- 1. bubbles above search bar in flow ---------------------------------
  await waitFor(send, `!!document.querySelector('.bubble-selector') && !!document.querySelector('[data-apex-search]')`);
  const order = await evalJs(send, `(() => {
    const b = document.querySelector('.bubble-selector');
    const s = document.querySelector('[data-apex-search]');
    if (!b || !s) return null;
    return { above: !!(b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) };
  })()`);
  check("bubbles precede search bar in DOM flow", order?.above === true);

  // -- 2. first click pins physician, no navigation, input focused ---------
  // Wait for the GSAP pop-in so the anchor is clickable.
  await sleep(1600);
  await evalJs(send, `(() => {
    const a = [...document.querySelectorAll('.bubble-btn')].find(x => x.textContent.includes('Physician'));
    a.click();
  })()`);
  await sleep(300);
  const pin = await evalJs(send, `(() => {
    const a = [...document.querySelectorAll('.bubble-btn')].find(x => x.textContent.includes('Physician'));
    return {
      pressed: a?.getAttribute('aria-pressed'),
      stillHome: location.pathname === '/',
      inputFocused: document.activeElement === document.querySelector('[data-apex-search] input'),
      openCue: a?.textContent.includes('open'),
    };
  })()`);
  check("physician bubble pins (aria-pressed=true)", pin?.pressed === "true");
  check("pin does not navigate", pin?.stillHome === true);
  check("search input focused after pin", pin?.inputFocused === true);
  check("pinned bubble shows open cue", pin?.openCue === true);

  // -- 3. query + Enter -> /physician?q= seeded ----------------------------
  await evalJs(send, `(() => {
    const input = document.querySelector('[data-apex-search] input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'marfan');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  await evalJs(send, `document.querySelector('[data-apex-search]').requestSubmit()`);
  const landed = await waitFor(send, `location.pathname === '/physician' && location.search.includes('q=marfan')`);
  check("Enter lands on /physician?q=marfan", landed === true, await evalJs(send, `location.href`));

  // -- 3b. crossfade: mesh backdrop lingers under the fading shell ---------
  // Immediately after the client-side nav the HeroMesh canvas (inside the
  // fixed -z-10 backdrop) must still be mounted while .physician-canvas
  // animates in; by ~linger+animation end it must be unmounted.
  const crossfade = await evalJs(send, `(() => {
    const mesh = document.querySelector('div.fixed.-z-10 canvas');
    const shell = document.querySelector('.physician-canvas');
    const anim = shell ? getComputedStyle(shell).animationName : null;
    return { meshMounted: !!mesh, shell: !!shell, anim, unfold: window.__meshUnfold ?? null };
  })()`);
  check("mesh canvas lingers under physician shell", crossfade?.meshMounted === true,
    JSON.stringify(crossfade));
  check("physician shell fade-in animation active", crossfade?.anim === "physician-canvas-in",
    String(crossfade?.anim));
  // Unfold: HeroMesh reports sphere->map progress on window.__meshUnfold.
  // It should be in flight (or just finished) during the linger window and
  // reach 1 by the time the mesh unmounts.
  const unfoldDone = await waitFor(send, `window.__meshUnfold === 1`, 4000, 100);
  check("sphere-to-map unfold completes", unfoldDone === true,
    "progress seen: " + JSON.stringify(crossfade?.unfold));
  const heroHandoff = await evalJs(send,
    `!!document.querySelector('.hero-panel-handoff')`);
  check("hero panel plays handoff fade", heroHandoff === true);
  // Settled state: mesh unmounted and shell background fully opaque. Poll
  // rather than fixed-sleep — headless under load can stretch the 450ms
  // linger + 450ms fade past a single checkpoint. Opaque = no alpha channel
  // in the serialized color (no "/ a" or rgba()).
  const settled = await waitFor(send, `(() => {
    const mesh = !!document.querySelector('div.fixed.-z-10 canvas');
    const bg = getComputedStyle(document.querySelector('.physician-canvas')).backgroundColor;
    const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && !bg.includes('/') && !bg.startsWith('rgba');
    return !mesh && opaque ? bg : false;
  })()`, 5000, 100);
  check("mesh unmounts and shell settles opaque", typeof settled === "string", String(settled));

  const seeded = await waitFor(send, `(() => {
    const inputs = [...document.querySelectorAll('input')];
    return inputs.some(i => i.value === 'marfan');
  })()`);
  check("workbench search input pre-seeded", seeded === true);

  const resultsShown = await waitFor(send, `(() => {
    const h2 = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('Search results'));
    if (!h2) return false;
    return document.querySelectorAll('ul a[href*="/physician/triage"]').length > 0;
  })()`, 15000);
  check("search results resolve from seeded query", resultsShown === true);

  // -- 4. pinned bubble navigates on second click --------------------------
  await evalJs(send, `(() => { location.href = '/'; })()`);
  await waitFor(send, `location.pathname === '/' && !!document.querySelector('.bubble-btn')`);
  await sleep(1600);
  await evalJs(send, `(() => {
    const a = [...document.querySelectorAll('.bubble-btn')].find(x => x.textContent.includes('Patient'));
    a.click();
  })()`);
  await sleep(300);
  await evalJs(send, `(() => {
    const a = [...document.querySelectorAll('.bubble-btn')].find(x => x.textContent.includes('Patient'));
    a.click();
  })()`);
  const navved = await waitFor(send, `location.pathname === '/patient'`);
  check("second click on pinned bubble navigates", navved === true, await evalJs(send, `location.href`));

  // -- 5. Escape ladder: query -> persona -> blur --------------------------
  await evalJs(send, `(() => { location.href = '/'; })()`);
  await waitFor(send, `location.pathname === '/' && !!document.querySelector('.bubble-btn')`);
  await sleep(1600);
  await evalJs(send, `(() => {
    const a = [...document.querySelectorAll('.bubble-btn')].find(x => x.textContent.includes('Physician'));
    a.click();
  })()`);
  await sleep(200);
  await evalJs(send, `(() => {
    const input = document.querySelector('[data-apex-search] input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'abc');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const esc = `(() => {
    const input = document.querySelector('[data-apex-search] input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`;
  await evalJs(send, esc);
  await sleep(150);
  const esc1 = await evalJs(send, `(() => ({
    q: document.querySelector('[data-apex-search] input').value,
    pinned: !!document.querySelector('.bubble-btn[aria-pressed="true"]'),
  }))()`);
  check("Escape 1 clears query, keeps pin", esc1?.q === "" && esc1?.pinned === true, JSON.stringify(esc1));
  await evalJs(send, esc);
  await sleep(150);
  const esc2 = await evalJs(send, `(() => ({
    pinned: !!document.querySelector('.bubble-btn[aria-pressed="true"]'),
  }))()`);
  check("Escape 2 unpins persona", esc2?.pinned === false, JSON.stringify(esc2));

} catch (e) {
  check("script completed", false, String(e));
} finally {
  proc.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ok */ }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
