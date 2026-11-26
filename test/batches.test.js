import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Factory, dateToday } from "../domain.js";
import { createApp } from "../server.js";

const today = dateToday();
const day = (n) => {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function setup(f = new Factory()) {
  let seq = 0;
  const user = (id) => f.get("SELECT * FROM users WHERE id=?", id);
  const act = (id, action, p, key) =>
    f.act(user(id), action, p, key || `b-${++seq}`);
  const produce = (code = "FRESH", expiry = day(3), extra = {}) =>
    act(2, "production", {
      bom_id: 1,
      batches: 1,
      batch: code,
      manufactured_on: today,
      expires_on: expiry,
      actual: 188,
      damaged: 6,
      labour: 1200,
      power: 600,
      components: [
        { item_id: 1, qty: 40 },
        { item_id: 2, qty: 10.5 },
        { item_id: 3, qty: 1.2 },
        { item_id: 4, qty: 194 },
        { item_id: 5, qty: 9 },
      ],
      ...extra,
    });
  const invoice = (qty) => {
    const o = act(3, "order", { customer_id: 1, lines: [{ item_id: 6, qty }] });
    act(1, "approve", o);
    return act(1, "invoice", o);
  };
  return { f, user, act, produce, invoice };
}

test("FEFO splits dispatch across batches and links customer, invoice and production without changing valuation", () => {
  const { f, user, act, produce, invoice } = setup();
  try {
    const run = produce();
    const inv = invoice(210);
    const plan = f.dispatchPreview(user(1), inv.id);
    assert.deepEqual(
      plan.map((b) => [b.code, b.qty]),
      [
        ["FRESH", 188000],
        ["DEMO-OPENING-6", 22000],
      ],
    );
    assert.equal(f.stock(6), 238000);
    assert.throws(
      () =>
        act(1, "dispatch", {
          ...inv,
          expected_batches: [{ batch_id: 999, qty: 210000 }],
        }),
      /availability changed/,
    );
    assert.equal(f.all("SELECT * FROM batch_allocations").length, 0);
    act(1, "dispatch", inv, "dispatch-once");
    act(1, "dispatch", inv, "dispatch-once");
    assert.equal(f.stock(6), 28000);
    assert.equal(f.all("SELECT * FROM batch_allocations").length, 2);
    assert.equal(
      f.batches().reduce((s, b) => s + b.remaining, 0),
      f.stock(6),
    );
    const trace = f.snapshot(user(1)).batch_trace;
    assert.equal(trace.find((a) => a.code === "FRESH").run_id, run.id);
    assert.equal(trace[0].customer, "Retailer A");
    assert.equal(trace[0].invoice_id, inv.id);
    assert.equal(f.valuation().runs[0].cost_per_packet, 3090);
    assert.equal(f.snapshot(user(3)).batches, undefined);
    assert.deepEqual(f.snapshot(user(2)).batch_trace, []);
    assert.throws(
      () => f.dispatchPreview(user(3), inv.id),
      /permission|allowed|access/i,
    );
  } finally {
    f.db.close();
  }
});

test("expiry warnings, unknown dates and reservations affect availability; dispatch rechecks expiry atomically", () => {
  const { f, user, act, produce, invoice } = setup();
  try {
    produce();
    assert.equal(
      f.batches().find((b) => b.code === "FRESH").status,
      "Expiring soon",
    );
    const inv = invoice(150);
    f.exec(
      "UPDATE stock_batches SET expires_on=? WHERE code=?",
      day(-1),
      "FRESH",
    );
    const before = f.all("SELECT * FROM movements");
    assert.throws(() => act(1, "dispatch", inv), /Not enough dispatchable/);
    assert.deepEqual(f.all("SELECT * FROM movements"), before);
    assert.equal(f.all("SELECT * FROM batch_allocations").length, 0);
    assert.equal(
      f.get("SELECT dispatched FROM invoices WHERE id=?", inv.id).dispatched,
      0,
    );
    const stock = f.snapshot(user(1)).stock.find((i) => i.id === 6);
    assert.equal(stock.qty, 238000);
    assert.equal(stock.held, 188000);
    assert.equal(stock.reserved, 150000);
    assert.equal(stock.available, 0);
    f.exec(
      "UPDATE stock_batches SET expires_on=? WHERE code=?",
      today,
      "FRESH",
    );
    act(1, "dispatch", inv);
    assert.equal(f.batches().find((b) => b.code === "FRESH").remaining, 38000);
    assert.equal(f.batches().find((b) => b.code === "FRESH").days_left, 0);
  } finally {
    f.db.close();
  }
});

test("production dates and batch uniqueness are validated with full rollback", () => {
  const { f, produce } = setup();
  try {
    for (const extra of [
      { expires_on: "" },
      { manufactured_on: day(1) },
      { manufactured_on: today, expires_on: day(-1) },
      { expires_on: "2026-02-30" },
    ]) {
      assert.throws(() => produce("BAD", day(3), extra));
      assert.equal(f.all("SELECT * FROM runs").length, 0);
      assert.equal(f.stock(6), 50000);
    }
    produce("DUPLICATE");
    const before = f.all("SELECT * FROM movements");
    assert.throws(() => produce("duplicate"), /already exists/);
    assert.deepEqual(f.all("SELECT * FROM movements"), before);
    assert.equal(f.all("SELECT * FROM runs").length, 1);
    assert.equal(f.batches().length, 2);
  } finally {
    f.db.close();
  }
});

test("legacy migration preserves balances, invents no history and supports audited splitting into verified batches", () => {
  const dir = mkdtempSync(join(tmpdir(), "my-order-batches-"));
  const path = join(dir, "factory.sqlite");
  let f = new Factory(path);
  try {
    const old = setup(f);
    old.produce();
    const inv = old.invoice(150);
    old.act(1, "dispatch", inv);
    // Simulate the actual pre-batch schema: it had no movement-to-batch FK.
    f.db.exec("ALTER TABLE movements DROP COLUMN batch_id");
    f.db.exec(
      "DROP TABLE batch_allocations; DROP TABLE stock_batches; PRAGMA user_version=1;",
    );
    f.db.close();
    f = new Factory(path);
    const { user, act } = setup(f);
    assert.equal(f.stock(6), 88000);
    assert.equal(f.available(6), 0);
    assert.equal(f.batches().length, 1);
    assert.equal(f.batches()[0].status, "Needs dates");
    assert.deepEqual(f.snapshot(user(1)).batch_trace, []);
    const before = f.all("SELECT * FROM movements");
    const p = {
      id: f.batches()[0].id,
      code: "ACTUAL-LABEL",
      qty: 40,
      manufactured_on: day(-2),
      expires_on: day(8),
      reason: "Checked physical packaging",
    };
    assert.throws(
      () => act(3, "batchRegister", p),
      /permission|allowed|access/i,
    );
    act(2, "batchRegister", p, "legacy-register");
    act(2, "batchRegister", p, "legacy-register");
    assert.equal(f.stock(6), 88000);
    assert.equal(f.available(6), 40000);
    assert.equal(f.batches().find((b) => b.legacy).remaining, 48000);
    assert.equal(
      f.all("SELECT * FROM audit WHERE action='batch dates verified'").length,
      1,
    );
    assert.deepEqual(f.all("SELECT * FROM movements"), before);
    assert.throws(
      () => act(1, "batchRegister", { ...p, code: "TOO-MANY", qty: 49 }),
      /cannot exceed/,
    );
    f.db.close();
    f = new Factory(path);
    assert.equal(f.batches().length, 2);
    assert.equal(f.available(6), 40000);
  } finally {
    f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP dispatch preview is authorized and invoice PDF includes allocated batches", async () => {
  const { server, factory: f } = createApp(":memory:", { assistantEnv: {} });
  const { produce, invoice, act } = setup(f);
  produce("HTTP-BATCH");
  const inv = invoice(100);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username) => {
    const r = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "Demo@12345" }),
    });
    return { Cookie: r.headers.get("set-cookie").split(";")[0] };
  };
  try {
    assert.equal((await fetch(base + `/api/dispatch/${inv.id}`)).status, 401);
    const sales = await login("salesman.a"),
      admin = await login("admin");
    assert.notEqual(
      (await fetch(base + `/api/dispatch/${inv.id}`, { headers: sales }))
        .status,
      200,
    );
    const preview = await (
      await fetch(base + `/api/dispatch/${inv.id}`, { headers: admin })
    ).json();
    assert.equal(preview.batches[0].code, "HTTP-BATCH");
    act(1, "dispatch", inv);
    const pdf = await (
      await fetch(base + `/api/invoice/${inv.id}.pdf`, { headers: admin })
    ).text();
    assert.match(pdf, /HTTP-BATCH/);
    assert.match(pdf, /Dispatched batches/);
  } finally {
    await new Promise((r) => server.close(r));
    f.db.close();
  }
});
