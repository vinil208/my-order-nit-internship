import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Factory } from "../domain.js";
import { setup, today, day } from "./helpers.js";

test("two independent SQLite writers cannot approve the same physical stock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "my-order-concurrency-")),
    path = join(dir, "test.sqlite");
  const f = new Factory(path);
  const { order } = setup(f);
  const a = order(40),
    b = order(40, 2);
  f.db.close();
  const gate = new SharedArrayBuffer(4);
  const workers = [a, b].map(
    (o) =>
      new Worker(new URL("./writer-worker.mjs", import.meta.url), {
        workerData: { path, id: o.id, gate },
      }),
  );
  try {
    const results = workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.on("message", (m) => {
            if (!m.ready) resolve(m);
          });
          w.once("error", reject);
        }),
    );
    await Promise.all(
      workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.on("message", (m) => {
              if (m.ready) resolve();
            });
            w.once("error", reject);
          }),
      ),
    );
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
    const r = await Promise.all(results);
    assert.equal(r.filter((x) => x.ok).length, 1);
    assert.match(r.find((x) => !x.ok).error, /Shortage/);
    const check = new Factory(path);
    assert.equal(check.stock(6), 50000);
    assert.equal(check.reserved(6), 40000);
    check.db.close();
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
    rmSync(dir, { recursive: true, force: true });
  }
});
test("v2 database migration preserves posted data and is safe to run repeatedly", () => {
  const dir = mkdtempSync(join(tmpdir(), "my-order-migration-")),
    path = join(dir, "old.sqlite");
  let f = new Factory(path);
  try {
    const { act, production } = setup(f);
    act(2, "production", production());
    const before = f.valuation().stock.map((i) => [i.id, i.qty, i.value]);
    f.db.exec("PRAGMA foreign_keys=OFF");
    for (const t of [
      "production_plans",
      "adjustments",
      "stock_returns",
      "refunds",
      "settings",
    ])
      f.db.exec(`DROP TABLE ${t}`);
    for (const [table, column] of [
      ["orders", "parent_id"],
      ["items", "reorder_level"],
      ["runs", "gas"],
      ["runs", "other"],
      ["movements", "posted_at"],
      ["movements", "batch_id"],
      ["movements", "frozen_value"],
    ])
      f.db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    f.exec("DELETE FROM users WHERE username='accountant'");
    f.exec("UPDATE users SET role='accountant' WHERE username='auditor'");
    f.db.exec("PRAGMA user_version=2");
    f.db.close();
    f = new Factory(path);
    assert.deepEqual(
      f.valuation().stock.map((i) => [i.id, i.qty, i.value]),
      before,
    );
    assert.equal(
      f.get("SELECT role FROM users WHERE username='auditor'").role,
      "auditor",
    );
    f.db.close();
    f = new Factory(path);
    assert.equal(
      f.all("SELECT * FROM users WHERE username='accountant'").length,
      1,
    );
    assert.deepEqual(
      f.valuation().stock.map((i) => [i.id, i.qty, i.value]),
      before,
    );
  } finally {
    f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("offline price conflicts and duplicate business references do not post twice", () => {
  const { f, act, invoice, counts } = setup();
  try {
    assert.throws(
      () => f.quantity(6, "1000000000", "carton"),
      /supported limits/,
    );
    assert.throws(
      () =>
        act(3, "order", {
          customer_id: 1,
          lines: [{ item_id: 6, qty: 1, expected_price: 4900 }],
        }),
      (e) => e.status === 409,
    );
    assert.equal(f.all("SELECT * FROM orders").length, 0);
    const inv = invoice(10);
    act(1, "payment", {
      invoice_id: inv.id,
      amount: 100,
      reference: "BANK-UNIQUE",
    });
    assert.throws(
      () =>
        act(1, "payment", {
          invoice_id: inv.id,
          amount: 100,
          reference: "BANK-UNIQUE",
        }),
      /already recorded/,
    );
    const p = {
      item_id: 1,
      qty: 10,
      rate: 45,
      supplier_id: 1,
      reference: "INV-UNIQUE",
    };
    act(1, "purchase", p);
    assert.throws(() => act(1, "purchase", p), /already received/);
  } finally {
    f.db.close();
  }
});
test("late return failure rolls back its stock document and quarantine batch", () => {
  const { f, act, invoice, counts } = setup();
  try {
    const inv = invoice(10);
    act(1, "dispatch", inv);
    const before = counts();
    f.db.exec(
      "CREATE TRIGGER fail_return BEFORE INSERT ON movements WHEN NEW.source='return' BEGIN SELECT RAISE(ABORT,'injected late failure'); END",
    );
    assert.throws(
      () => act(1, "returnGoods", { ...inv, reason: "Inspection" }),
      /injected/,
    );
    assert.deepEqual(counts(), before);
    assert.equal(f.all("SELECT * FROM stock_returns").length, 0);
  } finally {
    f.db.close();
  }
});
test("expiry of reserved stock contributes demand to planner and every new write enforces roles", () => {
  const { f, act, order, user } = setup();
  try {
    const o = order(40);
    act(1, "approve", o);
    f.exec("UPDATE stock_batches SET expires_on=?", day(-1));
    const p = f.planner(user(1))[0];
    assert.equal(p.reservation_deficit, 40000);
    assert.equal(p.shortage, 40000);
    for (const role of [3, 4, 5, 6])
      for (const action of [
        "configure",
        "approvePlan",
        "cancelPlan",
        "cancelOrder",
        "financialCredit",
        "returnGoods",
        "refund",
        "adjustment",
      ])
        assert.throws(
          () => act(role, action, {}),
          (e) => e.status === 403,
        );
  } finally {
    f.db.close();
  }
});
test("split fulfillment preserves linked remaining demand and cancellation releases reservation", () => {
  const { f, act, order } = setup();
  try {
    const o = order(80);
    assert.throws(
      () => act(1, "approve", { ...o, partial: true }),
      /Enable split/,
    );
    act(1, "configure", { fulfillment: "split", variance_tolerance: 3 });
    const result = act(1, "approve", { ...o, partial: true });
    assert.ok(result.backorder_id);
    assert.equal(f.reserved(6), 50000);
    assert.equal(
      JSON.parse(
        f.get("SELECT lines FROM orders WHERE id=?", result.backorder_id).lines,
      )[0].qty,
      30000,
    );
    act(1, "cancelOrder", { ...o, reason: "Customer cancelled" });
    assert.equal(f.available(6), 50000);
    assert.ok(
      f.get("SELECT id FROM audit WHERE action='reservation released'"),
    );
  } finally {
    f.db.close();
  }
});
test("accountant can collect; auditor is read-only; database blocks stock overwrites", () => {
  const { f, act, invoice, user } = setup();
  try {
    const inv = invoice(10);
    const accountant = f.get("SELECT * FROM users WHERE username='accountant'");
    f.act(
      accountant,
      "payment",
      { invoice_id: inv.id, amount: 100, reference: "ACC-1" },
      "acc1",
    );
    assert.throws(
      () =>
        act(5, "payment", { invoice_id: inv.id, amount: 1, reference: "NO" }),
      (e) => e.status === 403,
    );
    assert.equal(user(5).role, "auditor");
    assert.throws(
      () => f.exec("UPDATE movements SET qty=0 WHERE id=1"),
      /immutable/,
    );
    assert.throws(
      () => f.exec("DELETE FROM movements WHERE id=1"),
      /immutable/,
    );
    assert.throws(
      () => f.movement(user(1), today, 6, -99000, "adjustment", 999),
      /Insufficient/,
    );
  } finally {
    f.db.close();
  }
});
test("planner calculates benchmark shortage without double counting schedules or reservations", () => {
  const { f, act, order, production, user } = setup();
  try {
    act(1, "purchase", {
      item_id: 1,
      qty: 60,
      rate: 45,
      supplier_id: 1,
      reference: "BENCH-P",
    });
    act(2, "production", production());
    const first = order(150);
    act(1, "approve", first);
    const inv = act(1, "invoice", first);
    act(1, "dispatch", inv);
    order(120, 2);
    let p = f.planner(user(1))[0];
    assert.equal(p.available, 88000);
    assert.equal(p.shortage, 32000);
    assert.equal(p.batches, 1);
    assert.equal(p.expected, 200000);
    assert.equal(p.estimated_overheads, 180000);
    assert.equal(p.estimated_production_cost, 581500);
    const plan = act(1, "approvePlan", {
      product_id: 6,
      bom_id: 1,
      batches: 1,
      scheduled_on: today,
    });
    assert.equal(f.planner(user(1))[0].shortage, 0);
    assert.throws(
      () =>
        act(1, "approvePlan", {
          product_id: 6,
          bom_id: 1,
          batches: 1,
          scheduled_on: today,
        }),
      /No additional/,
    );
    const run = act(2, "production", production({ plan_id: plan.id }));
    assert.equal(
      f.get("SELECT run_id FROM production_plans WHERE id=?", plan.id).run_id,
      run.id,
    );
    assert.throws(
      () => act(2, "production", production({ plan_id: plan.id })),
      /Plan/,
    );
    assert.equal(f.reconciliation(user(5)).status, "Reconciled");
  } finally {
    f.db.close();
  }
});
test("planner deducts scheduled material demand and uses newest BOM only for new recommendations", () => {
  const { f, act, order, user } = setup();
  try {
    order(600);
    const p = f.planner(user(1))[0];
    assert.equal(p.batches, 3);
    assert.equal(p.materials.find((m) => m.item_id === 1).purchase_qty, 20000);
    const plan = act(1, "approvePlan", {
      product_id: 6,
      bom_id: 1,
      batches: 3,
      scheduled_on: today,
    });
    act(1, "master", {
      type: "bom",
      product_id: 6,
      name: "New smaller batch",
      yield: 100,
      components: [{ item_id: 1, qty: 20 }],
    });
    assert.equal(
      f.get("SELECT bom_id FROM production_plans WHERE id=?", plan.id).bom_id,
      1,
    );
    act(1, "cancelPlan", { ...plan, reason: "Reschedule" });
    assert.equal(f.planner(user(1))[0].batches, 6);
  } finally {
    f.db.close();
  }
});
test("configured tolerance, extra overheads, frozen material values and failed production are safe", () => {
  const { f, act, production, user } = setup();
  try {
    act(1, "configure", { fulfillment: "strict", variance_tolerance: 7 });
    const run = act(2, "production", production({ gas: 100, other: 50 }));
    let r = f.valuation().runs[0];
    assert.equal(r.tolerance, 700);
    assert.equal(r.total, 596000);
    const before = f.all(
      "SELECT frozen_value FROM movements WHERE source='production' AND qty<0",
    );
    assert.ok(before.every((m) => m.frozen_value < 0));
    act(1, "purchase", {
      item_id: 1,
      qty: 5,
      rate: 99,
      supplier_id: 1,
      reference: "AFTER",
    });
    assert.deepEqual(
      f.all(
        "SELECT frozen_value FROM movements WHERE source='production' AND qty<0",
      ),
      before,
    );
    act(
      2,
      "production",
      production({
        actual: 0,
        damaged: 0,
        failure_reason: "Burned demo batch",
      }),
    );
    r = f.valuation().runs.at(-1);
    assert.equal(r.cost_per_packet, 0);
    assert.ok(r.failed_cost > 0);
    assert.equal(f.reconciliation(user(1)).status, "Reconciled");
  } finally {
    f.db.close();
  }
});
test("credit, physical return and refund remain independent, traceable and duplicate safe", () => {
  const { f, act, invoice, user } = setup();
  try {
    const inv = invoice(10);
    act(1, "dispatch", inv);
    act(1, "payment", { invoice_id: inv.id, amount: 200, reference: "PAY" });
    act(1, "financialCredit", { ...inv, reason: "Correction" });
    assert.equal(f.stock(6), 40000);
    assert.equal(f.snapshot(user(1)).invoices[0].outstanding, 0);
    assert.throws(() => act(1, "financialCredit", { ...inv, reason: "Again" }));
    act(1, "returnGoods", { ...inv, reason: "All goods physically received" });
    assert.equal(f.stock(6), 50000);
    assert.equal(f.available(6), 40000);
    assert.throws(
      () => act(1, "returnGoods", { ...inv, reason: "Again" }),
      /already returned/,
    );
    act(1, "refund", { ...inv, amount: 100, reference: "REF-1" });
    act(1, "refund", { ...inv, amount: 100, reference: "REF-2" });
    assert.throws(
      () => act(1, "refund", { ...inv, amount: 1, reference: "REF-3" }),
      /unrefunded/,
    );
    assert.equal(f.reconciliation(user(5)).status, "Reconciled");
  } finally {
    f.db.close();
  }
});
test("adjustment and reversal reconcile; source corruption and orphan movement are detected", () => {
  const { f, act, user } = setup();
  try {
    const a = act(1, "adjustment", {
      item_id: 1,
      kind: "wastage",
      qty: 2,
      reason: "Spillage",
    });
    assert.equal(f.stock(1), 98000);
    act(1, "adjustment", { reverses_id: a.id, reason: "Weighing correction" });
    assert.equal(f.stock(1), 100000);
    assert.equal(f.valuation().stock[0].value, 420000);
    assert.throws(() =>
      act(1, "adjustment", { reverses_id: a.id, reason: "Duplicate" }),
    );
    assert.equal(f.reconciliation(user(5)).status, "Reconciled");
    f.movement(user(1), today, 1, 1000, "purchase", 999, "Orphan", 100);
    assert.equal(f.reconciliation(user(5)).status, "Needs investigation");
    assert.ok(
      f.reconciliation(user(5)).issues.some((i) => i.type === "Missing source"),
    );
  } finally {
    f.db.close();
  }
});
test("new reports, entity filters, discounts and owner metrics use posted amounts", () => {
  const { f, act, order, production, user } = setup();
  try {
    act(2, "production", production());
    const o = order(10);
    act(1, "approve", {
      ...o,
      lines: [{ item_id: 6, qty: 10, price: 50, discount: 10 }],
    });
    const inv = act(1, "invoice", o);
    act(1, "dispatch", inv);
    const s = f.snapshot(user(1));
    assert.equal(s.invoices[0].taxable, 45000);
    assert.equal(s.invoices[0].total, 47250);
    for (const type of [
      "raw-stock",
      "packaging-stock",
      "finished-stock",
      "costing",
      "expiry",
      "reconciliation",
      "refunds",
    ])
      assert.ok(
        Array.isArray(f.report(user(5), type, "2000-01-01", today).rows),
      );
    assert.equal(
      f.report(user(5), "sales", "2000-01-01", today, { customer_id: 2 }).rows
        .length,
      0,
    );
    assert.equal(
      f.report(user(5), "raw-stock", "2000-01-01", today).rows.length,
      3,
    );
    const d = f.dashboard(user(6), "2000-01-01", today);
    assert.equal(d.revenue, 45000);
    assert.equal(d.gross_profit, d.dispatch_revenue - d.cogs);
    act(1, "configure", { item_id: 1, reorder_level: 70 });
    assert.ok(
      f
        .snapshot(user(1))
        .alerts.some((a) => a.item_id === 1 && a.kind === "Low stock"),
    );
  } finally {
    f.db.close();
  }
});
