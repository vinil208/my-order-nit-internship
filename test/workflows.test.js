import test from "node:test";
import assert from "node:assert/strict";
import { setup, today, day } from "./helpers.js";
import { batchInventory } from "../batches.js";
import { units, money, validDate } from "../domain.js";
import { pdf, csv } from "../pdf.js";

test("numeric and calendar boundaries reject invalid inputs without rounding silently", () => {
  for (const value of ["-1", "NaN", "Infinity", "1e3", "", null, "1,000"])
    assert.throws(() => units(value), String(value));
  assert.equal(units("0.001"), 1);
  assert.equal(money("0.01"), 1);
  assert.equal(money("1.2300"), 123);
  assert.throws(() => money("1.2301"));
  assert.throws(() => units("1000000000001"));
  for (const d of [
    "2026-02-29",
    "2026-13-01",
    "2026-00-01",
    "2026-04-31",
    "2026-1-01",
    "",
  ])
    assert.throws(() => validDate(d));
  assert.equal(validDate("2028-02-29"), "2028-02-29");
});

test("all non-writing roles are denied every mutation without changing data", () => {
  const { f, act, counts } = setup();
  try {
    const before = counts();
    for (const role of [5, 6])
      for (const action of [
        "purchase",
        "production",
        "order",
        "approve",
        "invoice",
        "dispatch",
        "payment",
        "overhead",
        "credit",
        "master",
        "batchRegister",
      ])
        assert.throws(() => act(role, action, {}), /Access denied/);
    for (const action of [
      "purchase",
      "production",
      "approve",
      "invoice",
      "dispatch",
      "payment",
      "overhead",
      "credit",
      "master",
      "batchRegister",
    ])
      assert.throws(() => act(3, action, {}), /Access denied/);
    for (const action of [
      "order",
      "approve",
      "invoice",
      "dispatch",
      "payment",
      "credit",
      "master",
    ])
      assert.throws(() => act(2, action, {}), /Access denied/);
    assert.deepEqual(counts(), before);
  } finally {
    f.db.close();
  }
});

test("order validation rejects duplicate, unknown, fractional and zero lines; sales cannot set price", () => {
  const { f, act, counts } = setup();
  try {
    const before = counts();
    for (const lines of [
      [],
      [{ item_id: 6, qty: 0 }],
      [{ item_id: 6, qty: 0.5 }],
      [{ item_id: 1, qty: 1 }],
      [{ item_id: 999, qty: 1 }],
      [
        { item_id: 6, qty: 1 },
        { item_id: 6, qty: 2 },
      ],
    ])
      assert.throws(() => act(3, "order", { customer_id: 1, lines }));
    assert.deepEqual(counts(), before);
    const o = act(3, "order", {
      customer_id: 1,
      lines: [{ item_id: 6, qty: 1, price: 1 }],
    });
    assert.equal(
      JSON.parse(f.get("SELECT lines FROM orders WHERE id=?", o.id).lines)[0]
        .price,
      5000,
    );
  } finally {
    f.db.close();
  }
});

test("approval edits quantities, rejection requires reason and invalid transitions are blocked", () => {
  const { f, act, order } = setup();
  try {
    const o = order(20);
    assert.throws(() => act(1, "invoice", o), /approved/);
    act(1, "approve", { ...o, lines: [{ item_id: 6, qty: 15, price: 45 }] });
    assert.equal(f.reserved(6), 15000);
    const inv = act(1, "invoice", o);
    assert.equal(
      f.get("SELECT taxable FROM invoices WHERE id=?", inv.id).taxable,
      67500,
    );
    assert.throws(() => act(1, "approve", o), /submitted/);
    assert.throws(() => act(1, "invoice", o), /approved/);
    const rejected = order(5);
    assert.throws(
      () => act(1, "approve", { ...rejected, reject: true }),
      /reason/,
    );
    act(1, "approve", {
      ...rejected,
      reject: true,
      reason: "Customer cancelled",
    });
    assert.equal(
      f.get("SELECT status FROM orders WHERE id=?", rejected.id).status,
      "rejected",
    );
    assert.equal(f.reserved(6), 15000);
    assert.throws(() => act(1, "invoice", rejected));
  } finally {
    f.db.close();
  }
});

test("competing orders cannot overreserve or steal each other’s stock; credit releases reservations", () => {
  const { f, act, order, invoice } = setup();
  try {
    const first = invoice(30),
      second = order(25);
    assert.throws(() => act(1, "approve", second), /Shortage of 5/);
    act(1, "credit", { ...first, reason: "Cancelled before dispatch" });
    act(1, "approve", second);
    const inv = act(1, "invoice", second);
    act(1, "dispatch", inv);
    assert.equal(f.stock(6), 25000);
    assert.equal(f.reserved(6), 0);
    assert.throws(() => act(1, "dispatch", inv), /not yet dispatched/);
    assert.throws(
      () => act(1, "credit", { ...inv, reason: "Not a return" }),
      /returns workflow/,
    );
  } finally {
    f.db.close();
  }
});

test("partial and final payments reconcile and reject zero, excess, duplicate and credited payments", () => {
  const { f, user, act, invoice } = setup();
  try {
    const inv = invoice(10),
      p = { invoice_id: inv.id, amount: 200, reference: "PARTIAL" };
    act(1, "payment", p, "payment-retry");
    act(1, "payment", p, "payment-retry");
    assert.equal(f.snapshot(user(1)).invoices[0].outstanding, 32500);
    assert.throws(() => act(1, "payment", { ...p, amount: 0 }), /positive/);
    assert.throws(
      () => act(1, "payment", { ...p, amount: 326 }),
      /outstanding/,
    );
    assert.throws(
      () => act(1, "credit", { ...inv, reason: "No refunds" }),
      /collections/,
    );
    act(1, "payment", { ...p, amount: 325, reference: "FINAL" });
    assert.equal(f.snapshot(user(1)).invoices[0].outstanding, 0);
    assert.throws(
      () => act(1, "payment", { ...p, amount: 0.01 }),
      /outstanding/,
    );
    const cancelled = invoice(1);
    act(1, "credit", { ...cancelled, reason: "Cancelled" });
    assert.throws(
      () => act(1, "payment", { ...p, invoice_id: cancelled.id, amount: 1 }),
      /posted invoice/,
    );
  } finally {
    f.db.close();
  }
});

test("production validation rolls back missing, duplicate, zero and excessive consumption", () => {
  const { f, act, production, counts } = setup();
  try {
    const p = production(),
      before = counts();
    for (const extra of [
      { batches: 0 },
      { actual: 0 },
      { damaged: 0.5 },
      { components: p.components.slice(1) },
      { components: [...p.components, p.components[0]] },
      { components: p.components.map((c) => ({ ...c, qty: 0 })) },
      {
        components: p.components.map((c) => ({
          ...c,
          qty: c.item_id === 4 ? 188 : c.qty,
        })),
      },
      {
        components: p.components.map((c) => ({
          ...c,
          qty: c.item_id === 2 ? 999 : c.qty,
        })),
      },
    ])
      assert.throws(() => act(2, "production", { ...p, ...extra }));
    assert.deepEqual(counts(), before);
    assert.equal(f.stock(1), 100000);
  } finally {
    f.db.close();
  }
});

test("overhead amendments require reason, preserve quantities and audit before/after values", () => {
  const { f, act, production } = setup();
  try {
    const run = act(2, "production", production());
    const qty = f.stock(6);
    const old = f.get("SELECT * FROM runs WHERE id=?", run.id);
    assert.throws(
      () => act(2, "overhead", { ...run, labour: 2000, power: 800 }),
      /reason/,
    );
    assert.deepEqual(f.get("SELECT * FROM runs WHERE id=?", run.id), old);
    act(2, "overhead", {
      ...run,
      labour: 2000,
      power: 800,
      reason: "Final allocation",
    });
    assert.equal(f.stock(6), qty);
    const audit = JSON.parse(
      f.get("SELECT details FROM audit WHERE action='overheads amended'")
        .details,
    );
    assert.deepEqual(audit.before, { labour: 120000, power: 60000 });
    assert.deepEqual(audit.after, { labour: 200000, power: 80000 });
  } finally {
    f.db.close();
  }
});

test("batch status boundaries cover today, seven days, eight days, unknown, future and depleted", () => {
  const { f } = setup();
  try {
    const id = f.batches()[0].id;
    for (const [offset, status] of [
      [-1, "Expired"],
      [0, "Expiring soon"],
      [7, "Expiring soon"],
      [8, "Ready"],
    ]) {
      f.exec(
        "UPDATE stock_batches SET expires_on=? WHERE id=?",
        day(offset),
        id,
      );
      assert.equal(batchInventory(f, today)[0].status, status);
    }
    f.exec("UPDATE stock_batches SET manufactured_on=? WHERE id=?", day(1), id);
    assert.equal(f.batches()[0].status, "Not yet available");
    f.exec("UPDATE stock_batches SET expires_on=NULL WHERE id=?", id);
    assert.equal(f.batches()[0].status, "Needs dates");
    f.exec("UPDATE stock_batches SET qty=0 WHERE id=?", id);
    assert.equal(f.batches()[0].status, "Depleted");
  } finally {
    f.db.close();
  }
});

test("FEFO tie-breaks by manufacturing date then ID and rejects real stale previews", () => {
  const { f, user, act, production, invoice } = setup();
  try {
    act(
      2,
      "production",
      production({ batch: "FIRST", manufactured_on: day(-2) }),
    );
    act(
      2,
      "production",
      production({ batch: "SECOND", manufactured_on: day(-3) }),
    );
    const inv = invoice(200);
    const preview = f.dispatchPreview(user(1), inv.id);
    assert.equal(preview[0].code, "SECOND");
    assert.equal(preview[1].code, "FIRST");
    const other = invoice(10);
    act(1, "dispatch", other);
    assert.throws(
      () =>
        act(1, "dispatch", {
          ...inv,
          expected_batches: preview.map((b) => ({
            batch_id: b.batch_id,
            qty: b.qty,
          })),
        }),
      /availability changed/,
    );
    assert.equal(
      f.get("SELECT dispatched FROM invoices WHERE id=?", inv.id).dispatched,
      0,
    );
    const updated = f.dispatchPreview(user(1), inv.id);
    assert.equal(updated[0].qty, 178000);
    act(1, "dispatch", {
      ...inv,
      expected_batches: updated.map((b) => ({
        batch_id: b.batch_id,
        qty: b.qty,
      })),
    });
    assert.equal(
      f.batches().reduce((n, b) => n + b.remaining, 0),
      f.stock(6),
    );
  } finally {
    f.db.close();
  }
});

test("multi-product dispatch rolls back all allocations if any product expires", () => {
  const { f, act } = setup();
  try {
    const product = act(1, "master", {
      type: "item",
      name: "Second snack",
      kind: "finished",
      unit: "packet",
      price: 20,
      hsn: "210690",
      gst: 5,
      carton_size: 10,
    });
    const bom = act(1, "master", {
      type: "bom",
      product_id: product.id,
      name: "Second recipe",
      yield: 10,
      components: [{ item_id: 1, qty: 1 }],
    });
    act(2, "production", {
      bom_id: bom.id,
      batch: "SECOND-SNACK",
      batches: 1,
      actual: 10,
      manufactured_on: today,
      expires_on: day(1),
      components: [{ item_id: 1, qty: 1 }],
    });
    const o = act(3, "order", {
      customer_id: 1,
      lines: [
        { item_id: 6, qty: 5 },
        { item_id: product.id, qty: 5 },
      ],
    });
    act(1, "approve", o);
    const inv = act(1, "invoice", o);
    f.exec(
      "UPDATE stock_batches SET expires_on=? WHERE item_id=?",
      day(-1),
      product.id,
    );
    assert.throws(() => act(1, "dispatch", inv), /dispatchable/);
    assert.equal(f.all("SELECT * FROM batch_allocations").length, 0);
    assert.equal(f.stock(6), 50000);
    assert.equal(f.stock(product.id), 10000);
  } finally {
    f.db.close();
  }
});

test("purchase and master failures leave no partial records", () => {
  const { f, act, counts } = setup();
  try {
    const before = counts();
    for (const p of [
      { item_id: 6, qty: 1, rate: 10, supplier_id: 1, reference: "X" },
      { item_id: 1, qty: 1, rate: 10, supplier_id: 999, reference: "X" },
      { item_id: 1, qty: 0, rate: 10, supplier_id: 1, reference: "X" },
      { item_id: 1, qty: 1, rate: 10, supplier_id: 1, reference: "" },
    ])
      assert.throws(() => act(2, "purchase", p));
    assert.deepEqual(counts(), before);
    const size = f.all("SELECT * FROM boms").length;
    assert.throws(
      () =>
        act(1, "master", {
          type: "bom",
          product_id: 6,
          name: "Duplicate",
          yield: 10,
          components: [
            { item_id: 1, qty: 1 },
            { item_id: 1, qty: 1 },
          ],
        }),
      /unique/,
    );
    assert.equal(f.all("SELECT * FROM boms").length, size);
  } finally {
    f.db.close();
  }
});

test("reports honor period boundaries, credit dates and historical payment cutoff", () => {
  const { f, user, act, invoice } = setup();
  try {
    const inv = invoice(10);
    act(1, "payment", {
      invoice_id: inv.id,
      amount: 100,
      reference: "NEXT-DAY",
    });
    f.exec("UPDATE payments SET date=?", day(1));
    assert.equal(
      f.report(user(5), "outstanding", today, today).rows[0].Outstanding_INR,
      "525.00",
    );
    assert.equal(
      f.report(user(5), "outstanding", today, day(1)).rows[0].Outstanding_INR,
      "425.00",
    );
    assert.equal(f.report(user(5), "sales", day(1), day(2)).rows.length, 0);
    assert.equal(f.report(user(5), "collections", today, today).rows.length, 0);
    assert.throws(
      () => f.report(user(1), "stock", day(1), today),
      /Start date/,
    );
    assert.throws(
      () => f.report(user(1), "unknown", today, today),
      /Unknown report/,
    );
  } finally {
    f.db.close();
  }
});

test("PDF pagination and CSV escaping preserve content and current branding", () => {
  const result = pdf(
    "Test",
    Array.from({ length: 100 }, (_, i) => `Row ${i} (value) \\`),
  ).toString();
  assert.match(result, /Page 3 of 3/);
  assert.match(result, /Generated by My Order/);
  assert.match(result, /%%EOF/);
  const data = csv([{ x: "=SUM(A1)", y: 'hello,"world"\nnext', z: "+cmd" }]);
  assert.match(data, /'=SUM/);
  assert.match(data, /""world""/);
  assert.match(data, /'\+cmd/);
});

test("idempotency keys reject changed payloads and different actions instead of returning unrelated success", () => {
  const { f, act } = setup();
  try {
    const p = { customer_id: 1, lines: [{ item_id: 6, qty: 1 }] };
    const o = act(1, "order", p, "fixed");
    assert.deepEqual(act(1, "order", p, "fixed"), o);
    assert.throws(
      () => act(1, "order", { ...p, lines: [{ item_id: 6, qty: 2 }] }, "fixed"),
      /different request/,
    );
    assert.throws(() => act(1, "approve", o, "fixed"), /different request/);
    assert.equal(f.all("SELECT * FROM orders").length, 1);
    assert.equal(
      f.get("SELECT status FROM orders WHERE id=?", o.id).status,
      "submitted",
    );
  } finally {
    f.db.close();
  }
});

test("idempotency accepts reordered JSON fields and safely blocks unverifiable older submissions", () => {
  const { f, act } = setup();
  try {
    const p = {
      customer_id: 1,
      notes: "Same request",
      lines: [{ item_id: 6, qty: 2 }],
    };
    const o = act(1, "order", p, "canonical");
    assert.deepEqual(
      act(
        1,
        "order",
        {
          lines: [{ qty: 2, item_id: 6 }],
          notes: "Same request",
          customer_id: 1,
        },
        "canonical",
      ),
      o,
    );
    f.exec("UPDATE requests SET fingerprint=NULL WHERE key='canonical'");
    assert.throws(
      () => act(1, "order", p, "canonical"),
      /older request was already processed/,
    );
    assert.equal(f.all("SELECT * FROM orders").length, 1);
  } finally {
    f.db.close();
  }
});

test("100 mixed order scenarios preserve ledger, batch and reservation invariants", () => {
  const { f, act, order, production } = setup();
  try {
    act(2, "production", production());
    let seed = 417;
    let dispatched = 0;
    for (let index = 0; index < 100; index++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const qty = (seed % 9) + 1,
        o = order(qty),
        available = f.available(6);
      if (available < qty * 1000) {
        assert.throws(() => act(1, "approve", o), /Shortage/);
        act(1, "approve", { ...o, reject: true, reason: "Short stock" });
      } else {
        act(1, "approve", o);
        const inv = act(1, "invoice", o);
        if (seed % 4 === 0)
          act(1, "credit", { ...inv, reason: "Customer cancellation" });
        else {
          act(1, "dispatch", inv);
          dispatched += qty * 1000;
          act(1, "payment", {
            invoice_id: inv.id,
            amount: qty * 50 * 1.05,
            reference: `SIM-${index}`,
          });
        }
      }
      const batches = f.batches();
      assert.ok(batches.every((b) => b.remaining >= 0));
      assert.equal(
        batches.reduce((sum, b) => sum + b.remaining, 0),
        f.stock(6),
      );
      assert.equal(f.stock(6), 238000 - dispatched);
      assert.equal(f.reserved(6), 0);
      for (const s of f.valuation().stock)
        assert.ok(s.qty >= 0 && s.value >= 0);
    }
    assert.equal(f.get("PRAGMA integrity_check").integrity_check, "ok");
    assert.equal(f.all("PRAGMA foreign_key_check").length, 0);
  } finally {
    f.db.close();
  }
});
