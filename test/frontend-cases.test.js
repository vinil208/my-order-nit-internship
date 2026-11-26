import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { setup } from "./helpers.js";
import { AssistantPanel } from "../public/assistant-ui.js";

function ui() {
  const storage = new Map();
  const context = vm.createContext({
    document: { querySelector: () => ({}) },
    AssistantPanel,
    Intl,
    console,
    URLSearchParams,
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
  });
  const source = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  )
    .replace(/^import[^\n]+\n/, "")
    .split('window.addEventListener("online"')[0];
  vm.runInContext(source, context);
  return { context, storage, run: (code) => vm.runInContext(code, context) };
}

test("every permitted page renders for every role with empty and populated transactions", () => {
  const { f, user, act, production, invoice } = setup();
  const { context, run } = ui();
  try {
    for (const populated of [false, true]) {
      if (populated) {
        act(2, "production", production());
        const inv = invoice();
        act(1, "dispatch", inv);
        act(1, "payment", { invoice_id: inv.id, amount: 100, reference: "UI" });
      }
      for (const id of [1, 2, 3, 4, 5, 6]) {
        context.inputState = f.snapshot(user(id));
        run("state=inputState");
        for (const page of run("navigation().map(n=>n[0])")) {
          const html = run(`views[${JSON.stringify(page)}]()`);
          assert.equal(typeof html, "string");
          assert.ok(html.length > 100, `role ${id} page ${page}`);
          assert.doesNotMatch(html, /\bNaN\b/);
        }
      }
    }
  } finally {
    f.db.close();
  }
});

test("offline sync sends only the current user’s orders and preserves other users’ queues", async () => {
  const { context, storage, run } = ui();
  const sent = [];
  storage.set(
    "grain-queue",
    JSON.stringify([
      { user: 3, key: "own", body: { customer_id: 1 } },
      { user: 4, key: "other", body: { customer_id: 2 } },
    ]),
  );
  context.mockApi = async (path, body, key) => sent.push({ path, body, key });
  run("state={user:{id:3}};api=mockApi;refresh=async()=>{};toast=()=>{}");
  await run("sync()");
  assert.deepEqual(
    sent.map((x) => x.key),
    ["own"],
  );
  assert.deepEqual(
    JSON.parse(storage.get("grain-queue")).map((x) => x.key),
    ["other"],
  );
});

test("offline sync keeps failed orders for retry and does nothing while offline", async () => {
  const { context, storage, run } = ui();
  let calls = 0;
  storage.set(
    "grain-queue",
    JSON.stringify([
      { user: 3, key: "a", body: {} },
      { user: 3, key: "b", body: {} },
    ]),
  );
  context.mockApi = async () => {
    calls++;
    throw Error("Network interrupted");
  };
  run(
    "state={user:{id:3}};api=mockApi;refresh=async()=>{};toast=()=>{};navigator.onLine=false",
  );
  await run("sync()");
  assert.equal(calls, 0);
  run("navigator.onLine=true");
  await run("sync()");
  assert.equal(calls, 1);
  assert.equal(JSON.parse(storage.get("grain-queue")).length, 2);
});

test("offline sync preserves orders added while an earlier request is in flight", async () => {
  const { context, storage, run } = ui();
  let finish, started;
  const ready = new Promise((r) => (started = r));
  storage.set(
    "grain-queue",
    JSON.stringify([{ user: 3, key: "first", body: {} }]),
  );
  context.mockApi = async () => {
    started();
    await new Promise((r) => (finish = r));
  };
  run("state={user:{id:3}};api=mockApi;refresh=async()=>{};toast=()=>{}");
  const sync = run("sync()");
  await ready;
  const queue = JSON.parse(storage.get("grain-queue"));
  queue.push({ user: 3, key: "new", body: {} });
  storage.set("grain-queue", JSON.stringify(queue));
  finish();
  await sync;
  assert.deepEqual(
    JSON.parse(storage.get("grain-queue")).map((x) => x.key),
    ["new"],
  );
});

test("offline sync stops sending when the signed-in user changes", async () => {
  const { context, storage, run } = ui();
  let finish,
    started,
    calls = 0;
  const ready = new Promise((r) => (started = r));
  storage.set(
    "grain-queue",
    JSON.stringify([
      { user: 3, key: "first", body: {} },
      { user: 3, key: "second", body: {} },
    ]),
  );
  context.mockApi = async () => {
    calls++;
    if (calls === 1) {
      started();
      await new Promise((r) => (finish = r));
    }
  };
  run("state={user:{id:3}};api=mockApi;refresh=async()=>{};toast=()=>{}");
  const pending = run("sync()");
  await ready;
  run("state={user:{id:4}}");
  finish();
  await pending;
  assert.equal(calls, 1);
  assert.deepEqual(
    JSON.parse(storage.get("grain-queue")).map((x) => x.key),
    ["second"],
  );
});

test("assistant discards late responses after sign-out or new chat", async () => {
  let resolve;
  const panel = new AssistantPanel({
    api: () => new Promise((r) => (resolve = r)),
    escape: String,
    repaint: () => {},
    navigate: () => {},
  });
  const pending = panel.send("Explain");
  assert.equal(panel.pending, true);
  panel.reset();
  resolve({ answer: "Private old answer", sources: [], mode: "ai" });
  await pending;
  assert.deepEqual(panel.messages, []);
  assert.equal(panel.pending, false);
  assert.equal(panel.status, null);
});

test("concurrent sync triggers send a queued order only once", async () => {
  const { context, storage, run } = ui();
  let finish,
    started,
    calls = 0;
  const ready = new Promise((r) => (started = r));
  storage.set(
    "grain-queue",
    JSON.stringify([{ user: 3, key: "one", body: {} }]),
  );
  context.mockApi = async () => {
    calls++;
    started();
    await new Promise((r) => (finish = r));
  };
  run("state={user:{id:3}};api=mockApi;refresh=async()=>{};toast=()=>{}");
  const pending = run("sync()");
  await ready;
  await run("sync()");
  assert.equal(calls, 1);
  finish();
  await pending;
  assert.equal(JSON.parse(storage.get("grain-queue")).length, 0);
});

test("assistant renders untrusted text safely and distinguishes verified answers", () => {
  const escape = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const panel = new AssistantPanel({
    api: () => {},
    escape,
    repaint: () => {},
    navigate: () => {},
  });
  panel.status = {
    mode: "ai",
    provider: "ollama",
    model: "qwen3:0.6b",
    ready: true,
  };
  panel.messages = [
    {
      role: "assistant",
      content: "<img src=x onerror=alert(1)>",
      answerKind: "verified-records",
      mode: "ai",
      asOf: new Date().toISOString(),
      sources: [],
    },
  ];
  const html = panel.view("admin");
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Verified record answer/);
  assert.match(html, /Local AI · Ollama/);
});
