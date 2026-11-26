import { Factory, dateToday, decimal, rupees } from "./domain.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
const args = process.argv.slice(2),
  flag = (name) => args[args.indexOf(name) + 1];
const database = args.includes("--database")
  ? resolve(flag("--database"))
  : ":memory:";
if (database !== ":memory:") {
  if (existsSync(database))
    throw Error(
      "Benchmark requires a new database path. Existing data is never reset.",
    );
  mkdirSync(dirname(database), { recursive: true });
}
const f = new Factory(database);
let seq = 0;
const act = (id, action, p) =>
  f.act(
    f.get("SELECT * FROM users WHERE id=?", id),
    action,
    p,
    `benchmark-${++seq}`,
  );
try {
  const date = dateToday(),
    expiry = new Date(date + "T00:00:00Z");
  expiry.setUTCDate(expiry.getUTCDate() + 30);
  act(1, "purchase", {
    supplier_id: 1,
    item_id: 1,
    reference: "BENCHMARK-FLOUR-1",
    qty: 60,
    rate: 45,
  });
  const run = act(2, "production", {
    bom_id: 1,
    batches: 1,
    batch: "BENCHMARK-MK-1",
    manufactured_on: date,
    expires_on: expiry.toISOString().slice(0, 10),
    actual: 188,
    damaged: 6,
    labour: 0,
    power: 0,
    components: [
      { item_id: 1, qty: 40 },
      { item_id: 2, qty: 10.5 },
      { item_id: 3, qty: 1.2 },
      { item_id: 4, qty: 194 },
      { item_id: 5, qty: 9 },
    ],
  });
  const finishedAfterProduction = f.stock(6);
  const order = act(3, "order", {
    customer_id: 1,
    lines: [{ item_id: 6, qty: 150 }],
  });
  act(1, "approve", order);
  const invoice = act(1, "invoice", order);
  act(1, "dispatch", invoice);
  const second = act(4, "order", {
    customer_id: 2,
    lines: [{ item_id: 6, qty: 120 }],
  });
  assert.throws(() => act(1, "approve", second), /Shortage of 32/);
  act(1, "payment", {
    invoice_id: invoice.id,
    amount: 4000,
    reference: "BENCHMARK-PAYMENT-1",
  });
  act(2, "overhead", {
    ...run,
    labour: 1200,
    power: 600,
    reason: "Final benchmark labour and utility allocation after collection",
  });
  const s = f.snapshot(f.get("SELECT * FROM users WHERE id=1")),
    r = s.runs[0],
    inv = s.invoices[0];
  const actual = {
    flour_kg: f.stock(1) / 1000,
    oil_litre: f.stock(2) / 1000,
    spice_kg: f.stock(3) / 1000,
    pouches: f.stock(4) / 1000,
    cartons: f.stock(5) / 1000,
    finished_after_production: finishedAfterProduction / 1000,
    finished_after_dispatch: f.stock(6) / 1000,
    yield_variance_pct: r.yield_variance,
    oil_variance_pct: r.components.find((c) => c.item_id === 2).variance,
    taxable_inr: inv.taxable / 100,
    cgst_inr: inv.cgst / 100,
    sgst_inr: inv.sgst / 100,
    total_inr: inv.total / 100,
    paid_inr: inv.paid / 100,
    outstanding_inr: inv.outstanding / 100,
    shortage_packets: f.planner(s.user)[0].shortage / 1000,
    material_cost_inr: r.material / 100,
    run_cost_inr: r.total / 100,
    cost_per_packet_inr: r.cost_per_packet / 100,
    reconciliation: s.reconciliation.status,
  };
  assert.deepEqual(actual, {
    flour_kg: 120,
    oil_litre: 19.5,
    spice_kg: 3.8,
    pouches: 306,
    cartons: 21,
    finished_after_production: 238,
    finished_after_dispatch: 88,
    yield_variance_pct: -6,
    oil_variance_pct: 5,
    taxable_inr: 7500,
    cgst_inr: 187.5,
    sgst_inr: 187.5,
    total_inr: 7875,
    paid_inr: 4000,
    outstanding_inr: 3875,
    shortage_packets: 32,
    material_cost_inr: 4055,
    run_cost_inr: 5855,
    cost_per_packet_inr: 31.14,
    reconciliation: "Reconciled",
  });
  const reports = [
    "sales",
    "customer-sales",
    "product-sales",
    "gst",
    "purchases",
    "stock",
    "raw-stock",
    "packaging-stock",
    "finished-stock",
    "ledger",
    "production",
    "costing",
    "collections",
    "outstanding",
    "expiry",
    "reconciliation",
    "refunds",
  ];
  const reportCounts = Object.fromEntries(
    reports.map((type) => [
      type,
      f.report(s.user, type, date.slice(0, 7) + "-01", date).rows.length,
    ]),
  );
  const result = {
    generated_at: new Date().toISOString(),
    business_date: date,
    database,
    passed: true,
    actual,
    report_counts: reportCounts,
  };
  if (args.includes("--output"))
    writeFileSync(resolve(flag("--output")), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  f.db.close();
}
