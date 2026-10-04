#!/usr/bin/env node
// Quick CDP screenshot + console-error check for any page.
// Usage: node scripts/shot_physician.mjs <url> <outfile.png> [wait_ms]
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import http from "node:http";

const CANDIDATES = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const BIN = CANDIDATES.find((p) => existsSync(p));
if (!BIN) { console.error("no browser"); process.exit(2); }

const URL_ = process.argv[2] ?? "http://localhost:3000/physician";
const OUT = process.argv[3] ?? "/tmp/phys.png";
const WAIT = Number(process.argv[4] ?? 6000);
const PORT = 9224;

const proc = execFile(BIN, [
  "--headless", "--remote-debugging-port=" + PORT,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", `--user-data-dir=/tmp/phys-shot-${process.pid}`, "--window-size=1400,1000",
  URL_,
]);
proc.on("error", (e) => { console.error(e); process.exit(2); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (path) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path }, (r) => {
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(JSON.parse(b)));
  }).on("error", rej);
});

async function main() {
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(500);
    try { page = (await getJSON("/json")).find((t) => t.type === "page"); } catch { /* retry */ }
  }
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
    if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception?.description ?? "exception"));
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((r) => (ws.onopen = r));
  await send("Log.enable"); await send("Runtime.enable");
  await sleep(WAIT);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  const res = await send("Runtime.evaluate", { expression: "document.body.innerText.slice(0,600)", returnByValue: true });
  console.log("TEXT:", (res.result?.value ?? "").replace(/\n+/g, " | ").slice(0, 500));
  console.log("ERRORS:", errors.length ? errors.slice(0, 5) : "none");
  proc.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
