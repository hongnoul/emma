#!/usr/bin/env node
// E2E test of the graph page's node/edge click -> evidence side panel,
// driven over the Chrome DevTools Protocol. No test framework needed.
//
// Usage: node scripts/e2e_graph_click.mjs [browser-binary]
// Requires a Chromium-based browser; tries Brave then Chrome by default.

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

const PORT = 9223;
const URL = "http://localhost:3000/graph/DEMO-DIS-001";

const proc = execFile(BIN, [
  "--headless", "--remote-debugging-port=" + PORT,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", `--user-data-dir=/tmp/atlas-e2e-profile-${process.pid}`, "--window-size=1400,900",
  URL,
]);
proc.on("error", (e) => { console.error(e); process.exit(2); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(JSON.parse(b)));
    }).on("error", reject);
  });
}

async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const tabs = await jsonGet("/json");
      const tab = tabs.find((t) => t.url.includes("/graph/"));
      if (tab) return tab.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("browser tab not found");
}

let msgId = 0;
function makeWs(url) {
  // Minimal WebSocket client (no deps): Node >= 22 has global WebSocket.
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, call, ready: new Promise((r) => (ws.onopen = r)) };
}

async function evalJs(call, expression) {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

const failures = [];
const check = (name, cond) => {
  console.log((cond ? "PASS" : "FAIL"), name);
  if (!cond) failures.push(name);
};

async function clickAt(call, x, y) {
  // sigma resolves click targets from its hover state, which updates on
  // mousemove, so move first, then press/release.
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(400);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

try {
  const wsUrl = await connect();
  const { call, ready } = makeWs(wsUrl);
  await ready;
  await call("Runtime.enable");

  // Wait for sigma to be mounted
  let mounted = false;
  for (let i = 0; i < 30; i++) {
    mounted = await evalJs(call, "Boolean(window.__atlasSigma)");
    if (mounted) break;
    await sleep(500);
  }
  check("sigma mounted on page", mounted);
  await sleep(1000); // let layout/first render settle before computing coordinates

  const nNodes = await evalJs(call, "window.__atlasSigma.getGraph().order");
  const nEdges = await evalJs(call, "window.__atlasSigma.getGraph().size");
  check("graph populated (>20 nodes)", nNodes > 20);
  check("graph populated (>30 edges)", nEdges > 30);

  // Click the central disease node at its rendered viewport position.
  const pos = await evalJs(call, `
    (() => {
      const s = window.__atlasSigma;
      const a = s.getNodeDisplayData("DEMO-DIS-001");
      const p = s.framedGraphToViewport({ x: a.x, y: a.y });
      const r = s.getContainer().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    })()`);
  await clickAt(call, pos.x, pos.y);
  await sleep(600);
  let panel = await evalJs(call, "document.querySelector('aside')?.innerText ?? ''");
  check("node click opens side panel with name", panel.includes("Demo Lysosomal Storage Disorder A"));
  check("side panel shows type badge", panel.includes("Disease"));
  check("side panel shows identifier", panel.includes("DEMO-MONDO:0000001"));

  // Click an inferred SHARES_MECHANISM edge at its midpoint.
  const epos = await evalJs(call, `
    (() => {
      const s = window.__atlasSigma, g = s.getGraph();
      const key = g.edges().find(k => k.startsWith("DEMO-EDGE") && g.getEdgeAttribute(k, "color") === "#f59e0b"
        && !g.getNodeAttribute(g.source(k), "hidden") && !g.getNodeAttribute(g.target(k), "hidden"));
      if (!key) return null;
      const sa = s.getNodeDisplayData(g.source(key)), ta = s.getNodeDisplayData(g.target(key));
      const p = s.framedGraphToViewport({ x: (sa.x + ta.x) / 2, y: (sa.y + ta.y) / 2 });
      const r = s.getContainer().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y, key };
    })()`);
  if (epos) {
    // Thin line target: walk several points along the edge until the panel updates.
    let gotEvidence = false;
    for (const frac of [0.5, 0.4, 0.6, 0.3, 0.7, 0.45, 0.55]) {
      const pt = await evalJs(call, `
        (() => {
          const s = window.__atlasSigma, g = s.getGraph();
          const key = ${JSON.stringify(epos.key)};
          const sa = s.getNodeDisplayData(g.source(key)), ta = s.getNodeDisplayData(g.target(key));
          const p = s.framedGraphToViewport({ x: sa.x + (ta.x - sa.x) * ${frac}, y: sa.y + (ta.y - sa.y) * ${frac} });
          const r = s.getContainer().getBoundingClientRect();
          return { x: r.left + p.x, y: r.top + p.y };
        })()`);
      await clickAt(call, pt.x, pt.y);
      await sleep(400);
      panel = await evalJs(call, "document.querySelector('aside')?.innerText ?? ''");
      if (panel.includes("p(valid)") || panel.includes("DIRECT / CURATED") || panel.includes("ATLAS-INFERRED")) { gotEvidence = true; break; }
    }
    check("edge click shows provenance + p(valid)", gotEvidence);
  } else {
    check("found a visible inferred edge to click", false);
  }

  console.log(failures.length ? `\n${failures.length} failures` : "\nAll graph E2E checks passed.");
} catch (e) {
  console.error("E2E error:", e.message);
  failures.push("harness error");
} finally {
  proc.kill();
  await sleep(500); // let the browser release its profile before deleting it
  try { rmSync(`/tmp/atlas-e2e-profile-${process.pid}`, { recursive: true, force: true }); } catch {}
}
process.exit(failures.length ? 1 : 0);
