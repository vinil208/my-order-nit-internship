import test from "node:test";
import assert from "node:assert/strict";
import { Factory, units, money, fy, rupees, dateToday } from "../domain.js";
import { createApp } from "../server.js";
import { pdf, csv } from "../pdf.js";
const setup = () => {
  const f = new Factory();
  let seq = 0;
  const user = (id) => f.get("SELECT * FROM users WHERE id=?", id);
  return {
    f,
    user,
    act: (id, action, p, key) =>
      f.act(user(id), action, p, key || `test-${++seq}`),
  };
};
function produce(act, overheads = false) {
  return act(2, "production", {
    bom_id: 1,
    batches: "1",
    batch: "MK-DEMO-001",
    manufactured_on: dateToday(),
    expires_on: "2099-12-31",
    actual: "188",
    damaged: "6",
    labour: overheads ? "1200" : "0",
    power: overheads ? "600" : "0",
    components: [
      { item_id: 1, qty: "40" },
      { item_id: 2, qty: "10.5" },
      { item_id: 3, qty: "1.2" },
      { item_id: 4, qty: "194" },
      { item_id: 5, qty: "9" },
    ],
  });
}
test("mandatory benchmark: all expected figures, accounting and exports", () => {
  const { f, user, act } = setup();
  act(2, "purchase", {
    item_id: 1,
    qty: "60",
    rate: "45",
    supplier_id: 1,
    reference: "SUP-001",
  });
  const run = produce(act);
  let v = f.valuation();
  assert.equal(f.stock(6), 238000);
  assert.equal(f.stock(1), 120000);
  assert.equal(f.stock(2), 19500);
  assert.equal(f.stock(4), 306000);
  assert.equal(f.stock(5), 21000);
  assert.equal(v.runs[0].yield_variance, -6);
  assert.equal(v.runs[0].components[1].variance, 5);
  const o = act(3, "order", {
    customer_id: 1,
    lines: [{ item_id: 6, qty: "150" }],
  });
  act(1, "approve", o);
  assert.equal(f.available(6), 88000);
  const invoice = act(1, "invoice", o),
    i = f.get("SELECT * FROM invoices WHERE id=?", invoice.id);
  assert.deepEqual(
    [i.taxable, i.cgst, i.sgst, i.igst, i.total],
    [750000, 18750, 18750, 0, 787500],
  );
  act(1, "dispatch", invoice);
  assert.equal(f.stock(6), 88000);
  const b = act(4, "order", {
    customer_id: 2,
    lines: [{ item_id: 6, qty: "120" }],
  });
  assert.throws(() => act(1, "approve", b), /Shortage of 32/);
  assert.equal(
    f.get("SELECT status FROM orders WHERE id=?", b.id).status,
    "submitted",
  );
  act(1, "payment", {
    invoice_id: invoice.id,
    amount: "4000",
    reference: "BANK-DEMO-001",
  });
  act(2, "overhead", {
    id: run.id,
    labour: "1200",
    power: "600",
    reason: "Final utility and labour allocation",
  });
  const s = f.snapshot(user(1));
  assert.equal(s.invoices[0].outstanding, 387500);
  assert.equal(s.runs[0].material, 405500);
  assert.equal(s.runs[0].total, 585500);
  assert.equal(s.runs[0].cost_per_packet, 3114);
  assert.equal(rupees(s.runs[0].cost_per_packet), "31.14");
  for (const type of [
    "sales",
    "customer-sales",
    "product-sales",
    "gst",
    "stock",
    "ledger",
    "production",
    "purchases",
    "collections",
    "outstanding",
  ])
    assert.ok(
      f.report(user(5), type, "2020-01-01", "2099-12-31").rows.length > 0,
    );
  for (const stock of s.stock)
    assert.equal(
      s.ledger
        .filter((m) => m.item_id === stock.id)
        .reduce((n, m) => n + m.qty, 0),
      stock.qty,
    );
  assert.equal(f.snapshot(user(3)).orders.length, 1);
  assert.equal(f.snapshot(user(3)).invoices, undefined);
  assert.equal(f.snapshot(user(2)).invoices, undefined);
  assert.equal(f.snapshot(user(2)).customers.length, 0);
  f.db.close();
});
test("rollback, duplicate retry, role boundaries and unit conversions", () => {
  const { f, user, act } = setup();
  assert.equal(f.quantity(1, "40000", "g"), 40000);
  assert.equal(f.quantity(6, "2", "carton"), 40000);
  assert.throws(() => f.quantity(1, "1", "litre"), /Cannot convert/);
  assert.throws(() => f.quantity(6, "1.1", "packet"), /whole/);
  assert.throws(() => act(3, "purchase", { item_id: 1 }), /Access denied/);
  assert.throws(
    () => act(3, "order", { customer_id: 2, lines: [{ item_id: 6, qty: 1 }] }),
    /another salesman/,
  );
  const p = { customer_id: 1, lines: [{ item_id: 6, qty: "40" }] },
    a = act(3, "order", p, "same");
  assert.deepEqual(act(3, "order", p, "same"), a);
  assert.equal(f.all("SELECT * FROM orders").length, 1);
  act(1, "approve", a);
  const b = act(3, "order", p);
  assert.throws(() => act(1, "approve", b), /Shortage of 30/);
  const before = f.all("SELECT * FROM movements").length;
  assert.throws(
    () =>
      act(2, "production", {
        bom_id: 1,
        batches: 1,
        batch: "BAD",
        manufactured_on: dateToday(),
        expires_on: "2099-12-31",
        actual: 188,
        damaged: 6,
        components: [
          { item_id: 1, qty: 4000 },
          { item_id: 2, qty: 10.5 },
          { item_id: 3, qty: 1.2 },
          { item_id: 4, qty: 194 },
          { item_id: 5, qty: 9 },
        ],
      }),
    /Insufficient/,
  );
  assert.equal(f.all("SELECT * FROM movements").length, before);
  assert.equal(f.all("SELECT * FROM runs").length, 0);
  assert.equal(fy("2026-03-31"), "2025-26");
  assert.equal(fy("2026-04-01"), "2026-27");
  assert.equal(money("0.29"), 29);
  assert.throws(() => money("1.001"));
  assert.throws(() => units("Infinity"));
  assert.throws(
    () => f.report(user(3), "sales", "2026-01-01", "2026-12-31"),
    /Access denied/,
  );
  f.db.close();
});
test("interstate GST, overpayments, credit notes, immutable posting and historical reports", () => {
  const { f, user, act } = setup();
  const o = act(4, "order", {
    customer_id: 2,
    lines: [{ item_id: 6, qty: "20" }],
  });
  act(1, "approve", o);
  const i = act(1, "invoice", o);
  const inv = f.get("SELECT * FROM invoices WHERE id=?", i.id);
  assert.equal(inv.igst, 5000);
  assert.equal(inv.cgst, 0);
  assert.throws(
    () =>
      act(1, "payment", {
        invoice_id: i.id,
        amount: "99999",
        reference: "invalid",
      }),
    /greater than/,
  );
  act(1, "credit", { id: i.id, reason: "Customer cancellation" });
  assert.equal(f.available(6), 50000);
  assert.equal(f.all("SELECT * FROM invoices").length, 1);
  assert.equal(f.all("SELECT * FROM credits").length, 1);
  assert.throws(() => act(1, "dispatch", i), /must be posted/);
  const gst = f.report(user(1), "gst", "2020-01-01", "2099-12-31");
  assert.equal(
    gst.rows.reduce((n, r) => n + Number(r.IGST_INR), 0),
    0,
  );
  f.db.close();
});
test("master validation preserves zero GST and rejects zero carton sizes", () => {
  const { f, act } = setup();
  const product = {
    type: "item",
    name: "Zero-rated demo",
    kind: "finished",
    unit: "packet",
    price: "50",
    hsn: "210690",
    gst: 0,
    carton_size: 20,
  };
  const { id } = act(1, "master", product);
  assert.equal(f.get("SELECT gst FROM items WHERE id=?", id).gst, 0);
  assert.throws(
    () => act(1, "master", { ...product, carton_size: 0 }),
    /positive carton/,
  );
  f.db.close();
});

test("HTTP authentication, permissions and generated documents", async () => {
  const { server, factory } = createApp(":memory:");
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + "/api/state")).status, 401);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "Demo@12345" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const s = await fetch(base + "/api/state", { headers: { Cookie: cookie } });
    assert.equal((await s.json()).stock.length, 6);
    const r = await fetch(
      base + "/api/report?type=stock&from=2020-01-01&to=2099-12-31&format=pdf",
      { headers: { Cookie: cookie } },
    );
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.ok((await r.text()).startsWith("%PDF-1.4"));
    assert.equal(
      (
        await fetch(base + "/api/action/order", {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            Origin: "https://evil.example",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.ok(pdf("Example", ["one"]).includes(Buffer.from("%%EOF")));
    assert.ok(csv([{ a: "=CMD()" }]).includes("'=CMD()"));
  } finally {
    await new Promise((r) => server.close(r));
    factory.db.close();
  }
});
