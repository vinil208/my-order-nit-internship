import { dateToday, required, money, mul } from "./domain.js";
import { addBatch } from "./batches.js";

export function financialCredit(f, u, p) {
  f.permit(u, ["admin", "accountant"]);
  const inv = f.get(
    "SELECT * FROM invoices WHERE id=? AND status='posted'",
    Number(p.id),
  );
  if (!inv) throw Error("Select a posted, uncredited invoice.");
  const reason = required(p.reason, "Credit reason");
  const id = f.insert("credits", {
    date: dateToday(),
    number: "CN/" + inv.number,
    invoice_id: inv.id,
    amount: inv.total,
    reason,
    user_id: u.id,
  });
  f.exec("UPDATE invoices SET status='credited' WHERE id=?", inv.id);
  f.exec("UPDATE orders SET status='cancelled' WHERE id=?", inv.order_id);
  f.log(u, "financial credit issued", "invoice", inv.id, {
    id,
    reason,
    stock_changed: false,
  });
  f.log(u, "reservation released", "order", inv.order_id, { credit_id: id });
  return { id };
}
export function returnGoods(f, u, p) {
  f.permit(u, ["admin"]);
  const inv = f.get(
    "SELECT * FROM invoices WHERE id=? AND dispatched=1",
    Number(p.id),
  );
  if (!inv) throw Error("Only dispatched invoices have goods to return.");
  if (f.get("SELECT id FROM stock_returns WHERE invoice_id=?", inv.id))
    throw Error("These goods were already returned.");
  const allocations = f.all(
    "SELECT a.*,b.item_id,b.code FROM batch_allocations a JOIN stock_batches b ON b.id=a.batch_id WHERE a.invoice_id=?",
    inv.id,
  );
  if (!allocations.length)
    throw Error(
      "Historical dispatch has no batch allocation. Manual investigation is required.",
    );
  const reason = required(p.reason, "Physical return inspection reference");
  const id = f.insert("stock_returns", {
    date: dateToday(),
    invoice_id: inv.id,
    reason,
    user_id: u.id,
  });
  const valued = f.valuation();
  for (const line of JSON.parse(inv.lines)) {
    const dispatch = valued.ledger.find(
      (m) =>
        m.source === "dispatch" &&
        m.source_id === inv.id &&
        m.item_id === line.item_id,
    );
    if (!dispatch)
      throw Error(
        "Dispatch movement missing; investigate before returning stock.",
      );
    // Quarantine returned food. It cannot be resold without recorded inspection/dates.
    const batch_id = addBatch(f, {
      item_id: line.item_id,
      run_id: null,
      code: `RETURN-${id}-${line.item_id}`,
      qty: line.qty,
      manufactured_on: null,
      expires_on: null,
    });
    f.exec("UPDATE stock_batches SET legacy=1 WHERE id=?", batch_id);
    f.movement(
      u,
      dateToday(),
      line.item_id,
      line.qty,
      "return",
      id,
      reason,
      -dispatch.value,
      batch_id,
    );
  }
  f.log(u, "physical goods returned", "return", id, {
    invoice_id: inv.id,
    allocations,
    reason,
    quarantined: true,
  });
  return { id };
}
export function refund(f, u, p) {
  f.permit(u, ["admin", "accountant"]);
  const inv = f.get(
    "SELECT * FROM invoices WHERE id=? AND status='credited'",
    Number(p.id),
  );
  if (!inv) throw Error("Issue a credit before refunding a collection.");
  const paid = f.get(
    "SELECT COALESCE(SUM(amount),0) n FROM payments WHERE invoice_id=?",
    inv.id,
  ).n;
  const refunded = f.get(
    "SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE invoice_id=?",
    inv.id,
  ).n;
  const amount = money(p.amount);
  if (!amount || amount > paid - refunded)
    throw Error("Refund must not exceed unrefunded collections.");
  const id = f.insert("refunds", {
    date: dateToday(),
    invoice_id: inv.id,
    amount,
    reference: required(p.reference, "Refund reference"),
    user_id: u.id,
  });
  f.log(u, "refunded", "invoice", inv.id, { refund_id: id, amount });
  return { id };
}
export function adjustment(f, u, p) {
  f.permit(u, ["admin"]);
  const old = p.reverses_id
    ? f.get("SELECT * FROM adjustments WHERE id=?", Number(p.reverses_id))
    : null;
  if (p.reverses_id && !old) throw Error("Adjustment not found.");
  if (old?.reverses_id) throw Error("Reverse the original document only once.");
  const item_id = old?.item_id || Number(p.item_id),
    item = f.get("SELECT * FROM items WHERE id=?", item_id);
  if (!item) throw Error("Item not found.");
  if (!old && !["receipt", "wastage", "issue"].includes(p.kind))
    throw Error("Choose receipt, issue or wastage.");
  const qty = old
    ? -old.qty
    : f.quantity(item.id, p.qty, item.unit) * (p.kind === "receipt" ? 1 : -1);
  if (!qty) throw Error("Adjustment quantity must be positive.");
  const batch_id = old?.batch_id || (p.batch_id ? Number(p.batch_id) : null);
  if (item.kind === "finished") {
    const batch = f
      .batches()
      .find((b) => b.id === batch_id && b.item_id === item.id);
    if (!batch) throw Error("Select the affected finished-goods batch.");
    if (
      qty < 0 &&
      (batch.remaining < -qty ||
        (batch.eligible && f.available(item.id) < -qty))
    )
      throw Error("Adjustment would consume unavailable or reserved stock.");
  }
  const reason = required(p.reason, "Adjustment reason / source reference");
  const stock = f.valuation().stock.find((i) => i.id === item_id);
  const amount = old
    ? -old.amount
    : qty > 0
      ? mul(qty, money(p.rate || 0))
      : -mul(stock.value, -qty, stock.qty || 1);
  if (qty > 0 && !old && !amount)
    throw Error("Receipt requires a positive valuation rate.");
  if (qty < 0 && -amount > stock.value)
    throw Error(
      "Reversal would create negative inventory value; investigate consumed receipt first.",
    );
  if (qty < 0 && stock.qty + qty === 0 && stock.value + amount !== 0)
    throw Error(
      "Reversal would leave value without stock; investigate subsequent consumption first.",
    );
  const id = f.insert("adjustments", {
    date: dateToday(),
    item_id,
    batch_id,
    qty,
    amount,
    kind: old ? "reversal" : p.kind,
    reason,
    reverses_id: old?.id || null,
    user_id: u.id,
  });
  f.movement(
    u,
    dateToday(),
    item_id,
    qty,
    "adjustment",
    id,
    reason,
    amount,
    batch_id,
  );
  f.log(u, old ? "adjustment reversed" : "stock adjusted", "adjustment", id, {
    ...p,
    qty,
    amount,
  });
  return { id };
}

// Compare source-document quantities to the ledger; report anomalies without repairing history.
export function reconcile(f, to = dateToday()) {
  const v = f.valuation(),
    ledger = v.ledger.filter((m) => m.date <= to),
    issues = [],
    expected = new Map(),
    expectedSources = new Map();
  const add = (source, id, item, qty, amount = null) => {
    const key = `${source}:${id}:${item}`;
    expectedSources.set(key, { source, id, item, qty, amount });
    expected.set(item, (expected.get(item) || 0) + qty);
  };
  ledger
    .filter((m) => m.source === "opening")
    .forEach((m) => add(m.source, m.source_id, m.item_id, m.qty, m.amount));
  f.all("SELECT * FROM purchases WHERE date<=?", to).forEach((p) =>
    add("purchase", p.id, p.item_id, p.qty, p.amount),
  );
  f.all("SELECT * FROM runs WHERE date<=?", to).forEach((r) => {
    JSON.parse(r.components).forEach((c) =>
      add("production", r.id, c.item_id, -c.actual),
    );
    add("production", r.id, r.product_id, r.actual);
  });
  const invoices = f.all("SELECT * FROM invoices");
  invoices
    .filter((i) => i.dispatched)
    .forEach((i) => {
      const allocations = f.all(
        "SELECT * FROM batch_allocations WHERE invoice_id=?",
        i.id,
      );
      const dispatchDate =
        allocations[0]?.date ||
        ledger.find((m) => m.source === "dispatch" && m.source_id === i.id)
          ?.date;
      if (dispatchDate && dispatchDate <= to)
        JSON.parse(i.lines).forEach((l) =>
          add("dispatch", i.id, l.item_id, -l.qty),
        );
      if (!dispatchDate)
        issues.push({
          type: "Unreconciled invoice",
          reference: i.number,
          detail: "Dispatched flag has no dispatch evidence",
        });
    });
  f.all("SELECT * FROM adjustments WHERE date<=?", to).forEach((a) =>
    add("adjustment", a.id, a.item_id, a.qty, a.amount),
  );
  f.all("SELECT * FROM stock_returns WHERE date<=?", to).forEach((r) => {
    const inv = invoices.find((i) => i.id === r.invoice_id);
    JSON.parse(inv.lines).forEach((l) => add("return", r.id, l.item_id, l.qty));
  });
  let valueDifference = 0;
  for (const [key, source] of expectedSources) {
    const ms = ledger.filter(
      (m) => `${m.source}:${m.source_id}:${m.item_id}` === key,
    );
    if (ms.length !== 1)
      issues.push({
        type: ms.length ? "Duplicate reference" : "Missing movement",
        reference: key,
        detail: `Expected one movement, found ${ms.length}`,
      });
    if (ms.reduce((a, m) => a + m.qty, 0) !== source.qty)
      issues.push({
        type: "Quantity discrepancy",
        reference: key,
        detail: "Source quantity differs from ledger",
      });
    if (source.amount !== null && source.qty > 0) {
      const delta = ms.reduce((a, m) => a + m.value, 0) - source.amount;
      valueDifference += delta;
      if (delta)
        issues.push({
          type: "Valuation discrepancy",
          reference: key,
          detail: `${delta} paisa difference`,
        });
    }
  }
  for (const m of ledger) {
    if (!expectedSources.has(`${m.source}:${m.source_id}:${m.item_id}`))
      issues.push({
        type: "Missing source",
        reference: `movement:${m.id}`,
        detail: `${m.source} #${m.source_id}`,
      });
    if (m.balance < 0 || m.stock_value < 0)
      issues.push({
        type: "Negative-stock violation",
        reference: `movement:${m.id}`,
        detail: "Negative quantity or value",
      });
  }
  const rows = v.stock.map((i) => {
    const ms = ledger.filter((m) => m.item_id === i.id),
      recorded = ms.reduce((a, m) => a + m.qty, 0),
      expectedQty = expected.get(i.id) || 0;
    return {
      item_id: i.id,
      item: i.name,
      unit: i.unit,
      expected: expectedQty,
      recorded,
      difference: recorded - expectedQty,
      value: ms.reduce((a, m) => a + m.value, 0),
    };
  });
  for (const i of invoices.filter((i) => i.date <= to)) {
    const paid = f.get(
      "SELECT COALESCE(SUM(amount),0) n FROM payments WHERE invoice_id=? AND date<=?",
      i.id,
      to,
    ).n;
    const credits = f.get(
      "SELECT COALESCE(SUM(amount),0) n FROM credits WHERE invoice_id=? AND date<=?",
      i.id,
      to,
    ).n;
    const refunded = f.get(
      "SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE invoice_id=? AND date<=?",
      i.id,
      to,
    ).n;
    const lines = JSON.parse(i.lines);
    if (paid > i.total || refunded > paid || refunded > credits)
      issues.push({
        type: "Payment discrepancy",
        reference: i.number,
        detail: "Collections, credits or refunds exceed limits",
      });
    if (
      i.total !== i.taxable + i.cgst + i.sgst + i.igst ||
      lines.reduce((a, l) => a + l.taxable + l.cgst + l.sgst + l.igst, 0) !==
        i.total
    )
      issues.push({
        type: "Unreconciled invoice",
        reference: i.number,
        detail: "Invoice components do not reconcile",
      });
    if (credits > i.total)
      issues.push({
        type: "Credit discrepancy",
        reference: i.number,
        detail: "Credits exceed invoice",
      });
  }
  if (to === dateToday())
    for (const row of rows.filter(
      (r) =>
        f.get("SELECT kind FROM items WHERE id=?", r.item_id).kind ===
        "finished",
    )) {
      const batchQty = f
        .batches()
        .filter((b) => b.item_id === row.item_id)
        .reduce((a, b) => a + b.remaining, 0);
      if (batchQty !== row.recorded)
        issues.push({
          type: "Batch discrepancy",
          reference: row.item,
          detail: `Batch quantity ${batchQty}; ledger ${row.recorded}`,
        });
    }
  return {
    as_of: to,
    status:
      issues.length || rows.some((r) => r.difference)
        ? "Needs investigation"
        : "Reconciled",
    rows,
    issues,
    value_difference: valueDifference,
    valuation_basis:
      "Operational moving-average replay; source receipt values and frozen material issue values checked. Not a general-ledger trial balance.",
  };
}
