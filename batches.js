import { dateToday, validDate, required, decimal } from "./domain.js";

export function initializeBatches(f, fresh) {
  f.atomic(() => {
    f.db.exec(`
      CREATE TABLE IF NOT EXISTS stock_batches(
        id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id),
        run_id INTEGER UNIQUE REFERENCES runs(id), code TEXT NOT NULL COLLATE NOCASE,
        manufactured_on TEXT, expires_on TEXT, qty INTEGER NOT NULL CHECK(qty>=0),
        created_on TEXT NOT NULL, legacy INTEGER NOT NULL DEFAULT 0,
        UNIQUE(item_id,code));
      CREATE TABLE IF NOT EXISTS batch_allocations(
        id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        batch_id INTEGER NOT NULL REFERENCES stock_batches(id),
        qty INTEGER NOT NULL CHECK(qty>0), date TEXT NOT NULL,
        UNIQUE(invoice_id,batch_id));
      CREATE INDEX IF NOT EXISTS batch_item_expiry ON stock_batches(item_id,expires_on);
    `);
    if (f.get("PRAGMA user_version").user_version >= 2) return;
    const today = dateToday();
    for (const item of f
      .valuation()
      .stock.filter((i) => i.kind === "finished" && i.qty > 0)) {
      const expiry = new Date(today + "T00:00:00Z");
      expiry.setUTCDate(expiry.getUTCDate() + 30);
      f.insert("stock_batches", {
        item_id: item.id,
        run_id: null,
        code: fresh
          ? `DEMO-OPENING-${item.id}`
          : `LEGACY-UNVERIFIED-${item.id}`,
        manufactured_on: fresh ? today.slice(0, 7) + "-01" : null,
        expires_on: fresh ? expiry.toISOString().slice(0, 10) : null,
        qty: item.qty,
        created_on: today,
        legacy: fresh ? 0 : 1,
      });
    }
    f.db.exec("PRAGMA user_version=2");
  });
}

export function batchDates(p) {
  const manufactured_on = validDate(
    required(p.manufactured_on, "Manufacturing date"),
  );
  const expires_on = validDate(required(p.expires_on, "Expiry date"));
  if (manufactured_on > dateToday())
    throw Error("Manufacturing date cannot be in the future.");
  if (expires_on < manufactured_on)
    throw Error("Expiry cannot precede manufacturing.");
  return { manufactured_on, expires_on };
}

export function addBatch(f, p) {
  const code = required(p.code, "Batch number");
  if (code.length > 80)
    throw Error("Batch number must be 80 characters or fewer.");
  if (
    f.get(
      "SELECT id FROM stock_batches WHERE item_id=? AND code=?",
      p.item_id,
      code,
    )
  )
    throw Error(
      "This batch number already exists for the product. Use a unique batch number.",
    );
  return f.insert("stock_batches", {
    ...p,
    code,
    created_on: dateToday(),
    legacy: 0,
  });
}

export function batchInventory(f, today = dateToday()) {
  return f
    .all(
      `SELECT b.*, i.name AS product, i.unit,
    b.qty${f.get("SELECT name FROM sqlite_master WHERE type='table' AND name='adjustments'") ? "+COALESCE((SELECT SUM(x.qty) FROM adjustments x WHERE x.batch_id=b.id),0)" : ""}-COALESCE((SELECT SUM(a.qty) FROM batch_allocations a WHERE a.batch_id=b.id),0) AS remaining
    FROM stock_batches b JOIN items i ON i.id=b.item_id
    ORDER BY b.expires_on IS NULL, b.expires_on, b.manufactured_on, b.id`,
    )
    .map((b) => {
      const days_left = b.expires_on
        ? Math.round(
            (Date.parse(b.expires_on + "T00:00:00Z") -
              Date.parse(today + "T00:00:00Z")) /
              86400000,
          )
        : null;
      const status =
        b.remaining === 0
          ? "Depleted"
          : b.legacy || !b.expires_on || !b.manufactured_on
            ? "Needs dates"
            : b.expires_on < today
              ? "Expired"
              : b.manufactured_on > today
                ? "Not yet available"
                : days_left <= 7
                  ? "Expiring soon"
                  : "Ready";
      return {
        ...b,
        days_left,
        status,
        eligible: ["Ready", "Expiring soon"].includes(status),
      };
    });
}

export function usableStock(f, itemId) {
  const item = f.get("SELECT kind FROM items WHERE id=?", Number(itemId));
  if (item?.kind !== "finished") return f.stock(itemId);
  return batchInventory(f)
    .filter((b) => b.item_id === Number(itemId) && b.eligible)
    .reduce((sum, b) => sum + b.remaining, 0);
}

export function dispatchPlan(f, inv) {
  if (!inv || inv.status !== "posted" || inv.dispatched)
    throw Error("Invoice must be posted and not yet dispatched.");
  const plan = [];
  const batches = batchInventory(f);
  for (const line of JSON.parse(inv.lines)) {
    if (f.available(line.item_id, inv.order_id) < line.qty)
      throw Error(
        `Not enough dispatchable ${line.name}. Expired or undated batches are held, and other orders may reserve stock.`,
      );
    let need = line.qty;
    for (const batch of batches.filter(
      (b) => b.item_id === line.item_id && b.eligible,
    )) {
      const qty = Math.min(need, batch.remaining);
      if (qty > 0)
        plan.push({
          batch_id: batch.id,
          code: batch.code,
          item_id: batch.item_id,
          product: batch.product,
          run_id: batch.run_id,
          manufactured_on: batch.manufactured_on,
          expires_on: batch.expires_on,
          qty,
        });
      need -= qty;
      if (!need) break;
    }
    if (need)
      throw Error(
        `Batch stock is short by ${decimal(need)} packets. No dispatch was posted.`,
      );
  }
  return plan;
}

export function registerLegacy(f, u, p) {
  f.permit(u, ["admin", "production"]);
  const old = f.get(
    "SELECT * FROM stock_batches WHERE id=? AND legacy=1",
    Number(p.id),
  );
  if (!old) throw Error("Select unverified opening stock.");
  const qty = f.quantity(old.item_id, p.qty, "packet");
  if (!qty || qty > old.qty)
    throw Error(
      "Quantity must be positive and cannot exceed unverified stock.",
    );
  const dates = batchDates(p),
    reason = required(p.reason, "Verification reference or reason");
  const id = addBatch(f, {
    item_id: old.item_id,
    run_id: null,
    code: p.code,
    qty,
    ...dates,
  });
  f.exec("UPDATE stock_batches SET qty=qty-? WHERE id=?", qty, old.id);
  f.log(u, "batch dates verified", "batch", id, {
    from_batch_id: old.id,
    qty,
    ...dates,
    code: p.code,
    reason,
  });
  return { id };
}

export function batchTrace(f) {
  return f.all(`SELECT a.*, b.code, b.item_id, b.run_id, b.manufactured_on, b.expires_on,
    i.name AS product, inv.number AS invoice, inv.order_id, c.name AS customer
    FROM batch_allocations a JOIN stock_batches b ON b.id=a.batch_id
    JOIN items i ON i.id=b.item_id JOIN invoices inv ON inv.id=a.invoice_id
    JOIN customers c ON c.id=inv.customer_id ORDER BY a.id DESC`);
}
