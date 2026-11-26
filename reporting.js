import { decimal, rupees, dateToday, mul, validDate } from "./domain.js";
import { reconcile } from "./accounting.js";

export function filterSnapshot(f, s, filters = {}) {
  const customer = Number(filters.customer_id) || 0,
    product = Number(filters.product_id) || 0,
    batch = Number(filters.batch_id) || 0;
  const b = batch
    ? f.get("SELECT * FROM stock_batches WHERE id=?", batch)
    : null;
  if (batch && !b) throw Error("Batch not found.");
  const item = product || b?.item_id || 0;
  const allocationIds = batch
    ? new Set(
        f
          .all(
            "SELECT invoice_id FROM batch_allocations WHERE batch_id=?",
            batch,
          )
          .map((a) => a.invoice_id),
      )
    : null;
  s.invoices = s.invoices
    .filter(
      (i) =>
        (!customer || i.customer_id === customer) &&
        (!allocationIds || allocationIds.has(i.id)),
    )
    .map((i) => ({
      ...i,
      lines: i.lines.filter((l) => !item || l.item_id === item),
    }))
    .filter((i) => i.lines.length);
  // Recompute report-level amounts from selected lines; original documents stay immutable.
  if (item)
    s.invoices = s.invoices.map((i) => {
      const total = (k) => i.lines.reduce((a, l) => a + l[k], 0);
      return {
        ...i,
        taxable: total("taxable"),
        cgst: total("cgst"),
        sgst: total("sgst"),
        igst: total("igst"),
      };
    });
  const invoiceIds = new Set(s.invoices.map((i) => i.id));
  s.payments = s.payments.filter((p) => invoiceIds.has(p.invoice_id));
  s.credits = s.credits.filter((c) => invoiceIds.has(c.invoice_id));
  s.runs = s.runs.filter(
    (r) => (!item || r.product_id === item) && (!b || r.id === b.run_id),
  );
  s.stock = s.stock.filter((i) => !item || i.id === item);
  s.ledger = s.ledger.filter((m) => !item || m.item_id === item);
  s.purchases = s.purchases.filter((p) => !item || p.item_id === item);
  return s;
}
export function extraReport(f, type, from, to, filters = {}) {
  const item = Number(filters.product_id) || 0,
    batch = Number(filters.batch_id) || 0;
  const v = f.valuation(),
    within = (r) => r.date >= from && r.date <= to;
  if (type === "costing")
    return v.runs
      .filter(within)
      .filter(
        (r) =>
          (!item || r.product_id === item) &&
          (!batch ||
            f.get("SELECT run_id FROM stock_batches WHERE id=?", batch)
              ?.run_id === r.id),
      )
      .map((r) => {
        const product = f.get("SELECT * FROM items WHERE id=?", r.product_id),
          issues = v.ledger.filter(
            (m) =>
              m.source === "production" && m.source_id === r.id && m.qty < 0,
          );
        const raw = issues
          .filter(
            (m) =>
              f.get("SELECT kind FROM items WHERE id=?", m.item_id).kind ===
              "raw",
          )
          .reduce((a, m) => a - m.value, 0);
        const pouch = issues.find((m) => /pouch/i.test(m.item)),
          damaged =
            pouch && pouch.qty ? mul(-pouch.value, r.damaged, -pouch.qty) : 0;
        return {
          Date: r.date,
          Run: `RUN-${r.id}`,
          Batch: r.batch,
          Product: product.name,
          Raw_material_INR: rupees(raw),
          Packaging_INR: rupees(r.material - raw),
          Damaged_packaging_included_INR: rupees(damaged),
          Labour_INR: rupees(r.labour),
          Electricity_INR: rupees(r.power),
          Gas_INR: rupees(r.gas),
          Other_INR: rupees(r.other),
          Total_INR: rupees(r.total),
          Good_packets: decimal(r.actual),
          Cost_per_packet_INR: r.actual
            ? rupees(r.cost_per_packet)
            : "No good output",
          List_price_INR: rupees(product.price),
          Indicative_profit_per_packet_INR: r.actual
            ? rupees(product.price - r.cost_per_packet)
            : "N/A",
          Indicative_margin_pct:
            r.actual && product.price
              ? (
                  ((product.price - r.cost_per_packet) / product.price) *
                  100
                ).toFixed(2)
              : "N/A",
          Failed_run_cost_INR: rupees(r.failed_cost),
        };
      });
  if (type === "expiry")
    return f
      .batches()
      .filter(
        (b) =>
          b.created_on <= to &&
          (!item || b.item_id === item) &&
          (!batch || b.id === batch),
      )
      .map((b) => {
        const issued = f.get(
          "SELECT COALESCE(SUM(qty),0) n FROM batch_allocations WHERE batch_id=? AND date<=?",
          b.id,
          to,
        ).n;
        const adjustments = f.get(
          "SELECT COALESCE(SUM(qty),0) n FROM adjustments WHERE batch_id=? AND date<=?",
          b.id,
          to,
        ).n;
        const balance = b.qty - issued + adjustments;
        return {
          As_of: to,
          Batch_ID: b.id,
          Batch: b.code,
          Product: b.product,
          Run: b.run_id
            ? `RUN-${b.run_id}`
            : "Opening / return / verified stock",
          Manufactured: b.manufactured_on || "Unverified",
          Expiry: b.expires_on || "Unverified",
          Packets: decimal(balance),
          Status: !balance
            ? "Depleted"
            : b.legacy
              ? "Quarantined"
              : b.expires_on < to
                ? "Expired"
                : "In date",
        };
      });
  if (type === "reconciliation") {
    const rec = reconcile(f, to);
    return [
      ...rec.rows
        .filter((r) => !item || r.item_id === item)
        .map((r) => ({
          As_of: to,
          Reference: r.item,
          Check: "Stock balance",
          Expected: decimal(r.expected),
          Recorded: decimal(r.recorded),
          Difference: decimal(r.difference),
          Value_INR: rupees(r.value),
          Status: r.difference ? "Mismatch" : "Matched",
          Detail: rec.valuation_basis,
        })),
      ...rec.issues.map((i) => ({
        As_of: to,
        Reference: i.reference,
        Check: i.type,
        Expected: "",
        Recorded: "",
        Difference: "",
        Value_INR: "",
        Status: "Investigate",
        Detail: i.detail,
      })),
    ];
  }
  if (type === "refunds")
    return f
      .all(
        "SELECT r.*,i.number,i.customer_id,i.lines FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE r.date BETWEEN ? AND ?",
        from,
        to,
      )
      .filter(
        (r) =>
          (!filters.customer_id ||
            r.customer_id === Number(filters.customer_id)) &&
          (!item || JSON.parse(r.lines).some((l) => l.item_id === item)) &&
          (!batch ||
            f.get(
              "SELECT id FROM batch_allocations WHERE invoice_id=? AND batch_id=?",
              r.invoice_id,
              batch,
            )),
      )
      .map((r) => ({
        Date: r.date,
        Invoice: r.number,
        Reference: r.reference,
        Refund_INR: rupees(r.amount),
      }));
  return null;
}
export function dashboard(f, u, from, to) {
  f.permit(u, ["admin", "accountant", "auditor", "owner"]);
  validDate(from);
  validDate(to);
  if (from > to) throw Error("Invalid date range.");
  const s = f.snapshot(u),
    within = (r) => r.date >= from && r.date <= to;
  const revenue =
    s.invoices.filter(within).reduce((a, i) => a + i.taxable, 0) -
    s.credits
      .filter(within)
      .reduce(
        (a, c) =>
          a + (s.invoices.find((i) => i.id === c.invoice_id)?.taxable || 0),
        0,
      );
  const cogs =
    -s.ledger
      .filter((m) => within(m) && m.source === "dispatch")
      .reduce((a, m) => a + m.value, 0) -
    s.ledger
      .filter((m) => within(m) && m.source === "return")
      .reduce((a, m) => a + m.value, 0);
  const deliveredRevenue =
    s.invoices
      .filter(
        (i) =>
          i.dispatched &&
          s.ledger.some(
            (m) => m.source === "dispatch" && m.source_id === i.id && within(m),
          ),
      )
      .reduce((a, i) => a + i.taxable, 0) -
    s.credits
      .filter(within)
      .filter((c) => s.invoices.find((i) => i.id === c.invoice_id)?.dispatched)
      .reduce(
        (a, c) => a + s.invoices.find((i) => i.id === c.invoice_id).taxable,
        0,
      );
  const runs = s.runs.filter(within),
    expected = runs.reduce((a, r) => a + r.expected, 0),
    good = runs.reduce((a, r) => a + r.actual, 0);
  const outstanding = f.report(u, "outstanding", from, to).rows;
  return {
    from,
    to,
    revenue,
    collections: s.payments.filter(within).reduce((a, p) => a + p.amount, 0),
    refunds: s.refunds.filter(within).reduce((a, p) => a + p.amount, 0),
    dispatch_revenue: deliveredRevenue,
    cogs,
    gross_profit: deliveredRevenue - cogs,
    production_output: good,
    efficiency: expected ? (good / expected) * 100 : 0,
    damaged_pouches: runs.reduce((a, r) => a + r.damaged, 0),
    raw_material_excess: runs
      .flatMap((r) =>
        r.components.map((c) => ({
          run_id: r.id,
          item_id: c.item_id,
          qty: Math.max(0, c.actual - c.planned),
        })),
      )
      .filter(
        (c) => c.qty && s.items.find((i) => i.id === c.item_id)?.kind === "raw",
      ),
    outstanding: outstanding.reduce(
      (a, r) => a + Math.round(Number(r.Outstanding_INR) * 100),
      0,
    ),
    overdue: outstanding
      .filter((r) => r.Days_overdue > 0)
      .reduce((a, r) => a + Math.round(Number(r.Outstanding_INR) * 100), 0),
    daily_sales:
      s.invoices
        .filter((i) => i.date === dateToday())
        .reduce((a, i) => a + i.taxable, 0) -
      s.credits
        .filter((c) => c.date === dateToday())
        .reduce(
          (a, c) => a + s.invoices.find((i) => i.id === c.invoice_id).taxable,
          0,
        ),
  };
}
