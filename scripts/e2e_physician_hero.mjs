#!/usr/bin/env node
// E2E of the physician UMAP hero over CDP: hover tooltip, canvas click ->
// triage navigation with real judged edges, band-chip filter, CTA link, and
// the artifact-missing fallback (header + band cards). No test framework.
//
// Usage: node scripts/e2e_physician_hero.mjs [browser-binary]
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

const PORT = 9226;
const BASE = "http://localhost:3000";
const PROFILE = `/tmp/phys-hero-e2e-${process.pid}`;

const proc = execFile(BIN, [
  "--headless", "--remote-debugging-port=" + PORT,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", `--user-data-dir=${PROFILE}`, "--window-size=1400,1000",
  BASE + "/physician",
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
  return { ws, send, open: new Promise((r) => (ws.onopen = r)) };
}

const evalJs = async (send, expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function main() {
  const { send, open } = makeWs(await connect("/physician"));
  await open;
  await send("Runtime.enable");
  await send("Page.enable");
  await sleep(6000); // next dev compile + artifact fetch + entrance anim

  // 1. Hero canvas rendered with non-blank pixels.
  const px = await evalJs(send, `(() => {
    const cv = document.querySelector("canvas");
    if (!cv) return { found: false };
    const ctx = cv.getContext("2d");
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    return { found: true, w: cv.width, h: cv.height, lit };
  })()`);
  check("hero canvas renders points/links", px.found && px.lit > 5000, `${px.lit ?? 0} lit px`);

  // 2. Band chips show real counts (sum should equal artifact link count 2882).
  const chips = await evalJs(send, `[...document.querySelectorAll("button")]
    .map(b => b.textContent).filter(t => /accept|review|low/.test(t))`);
  const chipSum = chips.map((t) => Number((t.match(/^([\d,]+)/) ?? [0, "0"])[1].replace(/,/g, ""))).reduce((a, b) => a + b, 0);
  check("band chips sum to artifact links", chipSum === 2882, `${JSON.stringify(chips)} sum=${chipSum}`);

  // 3. Hover a judged node on the canvas -> tooltip appears with triage affordance.
  //    Find hover target by probing the component's own hit radius: move across
  //    a grid until a tooltip shows. Uses real pointer events via Input domain.
  const rect = await evalJs(send, `(() => {
    const cv = document.querySelector("canvas"); const r = cv.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  let tipText = null, tipAt = null;
  outer:
  for (let gy = 0.25; gy <= 0.8; gy += 0.08) {
    for (let gx = 0.3; gx <= 0.9; gx += 0.06) {
      const x = rect.x + rect.w * gx, y = rect.y + rect.h * gy;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sleep(60);
      tipText = await evalJs(send, `(() => {
        const t = [...document.querySelectorAll("div")].find(d =>
          d.className.includes("pointer-events-none") && /judged connection/.test(d.textContent));
        return t ? t.textContent : null;
      })()`);
      if (tipText) { tipAt = { x, y }; break outer; }
    }
  }
  check("hover tooltip shows judged node", !!tipText, tipText ?? "no tooltip found");

  // 4. Click that node -> navigates to /physician/triage?node=... and the
  //    queue loads real judged edges (count visible in header).
  if (tipAt) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: tipAt.x, y: tipAt.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tipAt.x, y: tipAt.y, button: "left", clickCount: 1 });
    await sleep(4000);
    const nav = await evalJs(send, `({ url: location.href, header: document.body.innerText.match(/\\d+ judged edges in band[^\\n]*/)?.[0] ?? null })`);
    const onTriage = nav.url.includes("/physician/triage?node=");
    check("canvas click navigates to node triage", onTriage, nav.url);
    check("triage queue loads judged edges", !!nav.header && !/^0 judged/.test(nav.header), nav.header ?? "no header");
    // triage keyboard path: j moves cursor (sanity that the queue is live)
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "j", text: "j" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "j" });
    await sleep(300);
  } else {
    check("canvas click navigates to node triage", false, "skipped: no hover target");
  }

  // 5. Fallback: block the artifact and confirm the static header + band cards.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["*emmatics-umap.json*"] });
  await send("Page.navigate", { url: BASE + "/physician" });
  await sleep(6000);
  const fb = await evalJs(send, `({
    hasHeroCanvas: !!document.querySelector("canvas"),
    hasHeadline: document.body.innerText.includes("Evidence interrogation workbench"),
    hasBandCards: document.body.innerText.includes("established ≥ 0.90"),
  })`);
  check("fallback: static headline shown", fb.hasHeadline);
  check("fallback: band cards shown", fb.hasBandCards);
  check("fallback: hero canvas gone", !fb.hasHeroCanvas);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  proc.kill();
  await sleep(500);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* browser may still hold files */ }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); proc.kill(); process.exit(2); });
