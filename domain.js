import { filterSnapshot, extraReport, dashboard } from "./reporting.js";
import {
  financialCredit,
  returnGoods,
  refund,
  adjustment,
  reconcile,
} from "./accounting.js";
import {
  productionPlanner,
  approvePlan,
  cancelPlan,
  inventoryAlerts,
} from "./planning.js";
import { migrate } from "./migrations.js";
import { DatabaseSync } from "node:sqlite";
import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  initializeBatches,
  batchDates,
  addBatch,
  batchInventory,
  usableStock,
  dispatchPlan,
  registerLegacy,
  batchTrace,
} from "./batches.js";

export function units(value, scale = 1000) {
  const s = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(s))
    throw Error("Enter a non-negative decimal number.");
  const [a, b = ""] = s.split(".");
  const places = Math.log10(scale);
  if (b.length > places && /[1-9]/.test(b.slice(places)))
    throw Error(`Use at most ${places} decimal places.`);
  const n = Number(
    BigInt(a) * BigInt(scale) +
      BigInt(b.slice(0, places).padEnd(places, "0") || 0),
  );
  if (!Number.isSafeInteger(n) || n > 1e12) throw Error("Number is too large.");
  return n;
}
export const money = (v) => units(v, 100);
export const rounded = (n, d) => {
  const result = (BigInt(n) + BigInt(d) / 2n) / BigInt(d);
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Calculated value exceeds supported limits.");
  return Number(result);
};
export const mul = (a, b, d = 1000) => rounded(BigInt(a) * BigInt(b), d);
export const decimal = (n, scale = 1000) =>
  (n / scale).toFixed(Math.log10(scale)).replace(/\.?0+$/, "") || "0";
export const rupees = (n) => (n / 100).toFixed(2);
export function required(s, name) {
  if (!String(s ?? "").trim()) throw Error(`${name} is required.`);
  return String(s).trim();
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
export function passwordHash(p, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(p, salt, 32).toString("hex")}`;
}
export function passwordMatches(p, hash) {
  const [s, h] = hash.split(":");
  return timingSafeEqual(
    Buffer.from(h, "hex"),
    Buffer.from(passwordHash(p, s).split(":")[1], "hex"),
  );
}
export function dateToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
}
export function fy(date) {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
export function validDate(d) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
    new Date(d).toISOString().slice(0, 10) !== d
  )
    throw Error("Invalid date.");
  return d;
}

export class Factory {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,username TEXT UNIQUE,role TEXT,password TEXT);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
      CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,unit TEXT NOT NULL,price INTEGER DEFAULT 0,hsn TEXT DEFAULT '',gst INTEGER DEFAULT 500,carton_size INTEGER DEFAULT 20);
      CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY,name TEXT,state TEXT,gstin TEXT,address TEXT,salesman_id INTEGER REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS suppliers(id INTEGER PRIMARY KEY,name TEXT,gstin TEXT);
      CREATE TABLE IF NOT EXISTS boms(id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES items(id),name TEXT,yield_qty INTEGER,components TEXT,active INTEGER DEFAULT 1);
      CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY,date TEXT,supplier_id INTEGER REFERENCES suppliers(id),reference TEXT,item_id INTEGER REFERENCES items(id),qty INTEGER,amount INTEGER,user_id INTEGER REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,date TEXT,product_id INTEGER REFERENCES items(id),bom_id INTEGER REFERENCES boms(id),batch TEXT,expected INTEGER,actual INTEGER,damaged INTEGER,components TEXT,labour INTEGER,power INTEGER,tolerance INTEGER,notes TEXT,user_id INTEGER REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,date TEXT,customer_id INTEGER REFERENCES customers(id),salesman_id INTEGER REFERENCES users(id),status TEXT,lines TEXT,notes TEXT);
      CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY,number TEXT UNIQUE,date TEXT,order_id INTEGER UNIQUE REFERENCES orders(id),customer_id INTEGER REFERENCES customers(id),lines TEXT,taxable INTEGER,cgst INTEGER,sgst INTEGER,igst INTEGER,total INTEGER,status TEXT,due_date TEXT,dispatched INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,date TEXT,invoice_id INTEGER REFERENCES invoices(id),amount INTEGER,reference TEXT,user_id INTEGER REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS credits(id INTEGER PRIMARY KEY,date TEXT,number TEXT UNIQUE,invoice_id INTEGER UNIQUE REFERENCES invoices(id),amount INTEGER,reason TEXT,user_id INTEGER REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,date TEXT,item_id INTEGER REFERENCES items(id),qty INTEGER,amount INTEGER DEFAULT 0,source TEXT,source_id INTEGER,note TEXT,user_id INTEGER REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,user_id INTEGER REFERENCES users(id),action TEXT,entity TEXT,entity_id INTEGER,details TEXT);
      CREATE TABLE IF NOT EXISTS requests(user_id INTEGER,key TEXT,result TEXT,PRIMARY KEY(user_id,key));
      CREATE INDEX IF NOT EXISTS movement_item ON movements(item_id,id);
      CREATE INDEX IF NOT EXISTS invoice_customer ON invoices(customer_id);
      `);
    const fresh = !this.get("SELECT id FROM users LIMIT 1");
    if (fresh) this.seed();
    initializeBatches(this, fresh);
    if (
      !this.all("PRAGMA table_info(requests)").some(
        (c) => c.name === "fingerprint",
      )
    )
      this.db.exec("ALTER TABLE requests ADD COLUMN fingerprint TEXT");
    migrate(this);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  exec(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  insert(table, o) {
    const keys = Object.keys(o);
    return Number(
      this.exec(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ...Object.values(o),
      ).lastInsertRowid,
    );
  }
  atomic(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const x = fn();
      this.db.exec("COMMIT");
      return x;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  log(user, action, entity, id, details) {
    this.insert("audit", {
      time: new Date().toISOString(),
      user_id: user.id,
      action,
      entity,
      entity_id: id,
      details: JSON.stringify(details),
    });
  }
  permit(user, roles) {
    if (!roles.includes(user.role)) {
      const err = Error("Access denied for this role.");
      err.status = 403;
      throw err;
    }
  }
  seed() {
    this.atomic(() => {
      for (const [name, username, role] of [
        ["Factory Admin", "admin", "admin"],
        ["Production Supervisor", "production", "production"],
        ["Salesman A", "salesman.a", "salesman"],
        ["Salesman B", "salesman.b", "salesman"],
        ["Accountant", "auditor", "accountant"],
        ["Owner", "owner", "owner"],
      ])
        this.insert("users", {
          name,
          username,
          role,
          password: passwordHash("Demo@12345"),
        });
      const items = [
        ["Flour", "raw", "kg", 0, "1101"],
        ["Cooking oil", "raw", "litre", 0, "1507"],
        ["Salt & spice mix", "raw", "kg", 0, "0910"],
        ["200 g pouch", "packaging", "piece", 0, "3923"],
        ["Carton", "packaging", "piece", 0, "4819"],
        ["Murukku 200 g", "finished", "packet", 5000, "210690"],
      ];
      items.forEach(([name, kind, unit, price, hsn]) =>
        this.insert("items", {
          name,
          kind,
          unit,
          price,
          hsn,
          gst: 500,
          carton_size: 20,
        }),
      );
      this.insert("customers", {
        name: "Retailer A",
        state: "Tamil Nadu",
        gstin: "33AAAAA0000A1Z5",
        address: "12 Market Road, Tiruchirappalli, Tamil Nadu",
        salesman_id: 3,
      });
      this.insert("customers", {
        name: "Distributor B",
        state: "Karnataka",
        gstin: "29BBBBB0000B1Z5",
        address: "24 Market Road, Bengaluru, Karnataka",
        salesman_id: 4,
      });
      this.insert("suppliers", {
        name: "Cauvery Ingredients (demo)",
        gstin: "33CCCCC0000C1Z5",
      });
      this.insert("boms", {
        product_id: 6,
        name: "Murukku 200 g · standard batch",
        yield_qty: 200000,
        components: JSON.stringify([
          { item_id: 1, qty: 40000 },
          { item_id: 2, qty: 10000 },
          { item_id: 3, qty: 1200 },
          { item_id: 4, qty: 200000 },
          { item_id: 5, qty: 10000 },
        ]),
      });
      [
        [100000, 420000],
        [30000, 420000],
        [5000, 100000],
        [500000, 125000],
        [30000, 45000],
        [50000, 125000],
      ].forEach(([qty, amount], i) =>
        this.insert("movements", {
          date: dateToday().slice(0, 7) + "-01",
          item_id: i + 1,
          qty,
          amount,
          source: "opening",
          source_id: 0,
          note: "Benchmark opening balance",
          user_id: 1,
        }),
      );
    });
  }
  financialCredit(u, p) {
    return financialCredit(this, u, p);
  }
  returnGoods(u, p) {
    return returnGoods(this, u, p);
  }
  refund(u, p) {
    return refund(this, u, p);
  }
  adjustment(u, p) {
    return adjustment(this, u, p);
  }
  reconciliation(u, to = dateToday()) {
    this.permit(u, ["admin", "accountant", "auditor", "owner"]);
    return reconcile(this, to);
  }
  planner(u) {
    this.permit(u, ["admin", "production", "accountant", "auditor", "owner"]);
    return productionPlanner(this);
  }
  approvePlan(u, p) {
    return approvePlan(this, u, p);
  }
  cancelPlan(u, p) {
    return cancelPlan(this, u, p);
  }
  quantity(itemId, value, unit) {
    const i = this.get("SELECT * FROM items WHERE id=?", Number(itemId));
    if (!i) throw Error("Item not found.");
    let q = units(value);
    if (unit && unit !== i.unit) {
      if (
        (i.unit === "kg" && unit === "g") ||
        (i.unit === "litre" && unit === "ml")
      ) {
        if (q % 1000) throw Error("Minimum precision is 1 g or 1 ml.");
        q /= 1000;
      } else if (i.unit === "packet" && unit === "carton") q *= i.carton_size;
      else throw Error(`Cannot convert ${unit} to ${i.unit}.`);
    }
    if (!Number.isSafeInteger(q) || q > 1e12)
      throw Error("Converted quantity exceeds supported limits.");
    if (["piece", "packet"].includes(i.unit) && q % 1000)
      throw Error("Pieces and packets must be whole numbers.");
    return q;
  }
  valuation() {
    const balances = Object.fromEntries(
      this.all("SELECT * FROM items").map((i) => [
        i.id,
        { ...i, qty: 0, value: 0 },
      ]),
    );
    const runs = Object.fromEntries(
      this.all("SELECT * FROM runs").map((r) => [r.id, { ...r, material: 0 }]),
    );
    const ledger = [];
    for (const m of this.all("SELECT * FROM movements ORDER BY id")) {
      const b = balances[m.item_id];
      let value = m.amount;
      if (m.qty < 0)
        value = m.frozen_value ?? -mul(b.value, -m.qty, b.qty || 1);
      if (m.source === "production" && m.qty < 0)
        runs[m.source_id].material -= value;
      if (m.source === "production" && m.qty > 0) {
        const r = runs[m.source_id];
        value = r.material + r.labour + r.power + (r.gas || 0) + (r.other || 0);
      }
      if (m.source === "production" && m.qty === 0) value = 0;
      b.qty += m.qty;
      b.value += value;
      ledger.push({
        ...m,
        value,
        balance: b.qty,
        stock_value: b.value,
        item: b.name,
        unit: b.unit,
      });
    }
    return {
      stock: Object.values(balances),
      ledger,
      runs: Object.values(runs).map((r) => ({
        ...r,
        total: r.material + r.labour + r.power + (r.gas || 0) + (r.other || 0),
        cost_per_packet: r.actual
          ? mul(
              r.material + r.labour + r.power + (r.gas || 0) + (r.other || 0),
              1000,
              r.actual,
            )
          : 0,
        failed_cost: r.actual
          ? 0
          : r.material + r.labour + r.power + (r.gas || 0) + (r.other || 0),
        components: JSON.parse(r.components),
        yield_variance: r.expected
          ? ((r.actual - r.expected) / r.expected) * 100
          : 0,
      })),
    };
  }
  stock(id) {
    return this.valuation().stock.find((s) => s.id === Number(id))?.qty || 0;
  }
  reserved(id, exceptOrder = 0) {
    let reserved = 0;
    for (const o of this.all(
      "SELECT * FROM orders WHERE status IN ('approved','invoiced') AND id<>?",
      exceptOrder,
    ))
      for (const l of JSON.parse(o.lines))
        if (l.item_id === Number(id)) reserved += l.qty;
    return reserved;
  }
  available(id, exceptOrder = 0) {
    return Math.max(0, usableStock(this, id) - this.reserved(id, exceptOrder));
  }
  batches() {
    return batchInventory(this);
  }
  batchRegister(u, p) {
    return registerLegacy(this, u, p);
  }
  dispatchPreview(u, id) {
    this.permit(u, ["admin"]);
    return dispatchPlan(
      this,
      this.get("SELECT * FROM invoices WHERE id=?", Number(id)),
    );
  }
  movement(
    user,
    date,
    item_id,
    qty,
    source,
    source_id,
    note = "",
    amount = 0,
    batch_id = null,
  ) {
    if (qty < 0 && this.stock(item_id) < -qty)
      throw Error("Insufficient stock. No transaction was posted.");
    return this.insert("movements", {
      date,
      item_id,
      qty,
      amount,
      source,
      source_id,
      note,
      user_id: user.id,
      posted_at: new Date().toISOString(),
      batch_id,
      frozen_value:
        source === "adjustment" && qty < 0
          ? amount
          : source === "production" && qty < 0
            ? (() => {
                const b = this.valuation().stock.find(
                  (i) => i.id === Number(item_id),
                );
                return -mul(b.value, -qty, b.qty);
              })()
            : null,
    });
  }
  purchase(u, p) {
    this.permit(u, ["admin", "production"]);
    const item = this.get("SELECT * FROM items WHERE id=?", Number(p.item_id));
    if (!item || item.kind === "finished")
      throw Error("Select a raw or packaging material.");
    const qty = this.quantity(item.id, p.qty, p.unit),
      rate = money(p.rate);
    if (!qty || !rate) throw Error("Quantity and rate must be positive.");
    if (
      this.get(
        "SELECT id FROM purchases WHERE supplier_id=? AND reference=? AND item_id=?",
        Number(p.supplier_id),
        required(p.reference, "Supplier reference"),
        item.id,
      )
    )
      throw Error(
        "This supplier reference and material were already received.",
      );
    const amount = mul(qty, rate),
      date = dateToday();
    const id = this.insert("purchases", {
      date,
      supplier_id: Number(p.supplier_id),
      reference: required(p.reference, "Supplier reference"),
      item_id: item.id,
      qty,
      amount,
      user_id: u.id,
    });
    this.movement(u, date, item.id, qty, "purchase", id, p.reference, amount);
    this.log(u, "posted", "purchase", id, { ...p, qty, amount });
    return { id };
  }
  production(u, p) {
    this.permit(u, ["production", "admin"]);
    const plan = p.plan_id
      ? this.get(
          "SELECT * FROM production_plans WHERE id=? AND status='scheduled'",
          Number(p.plan_id),
        )
      : null;
    if (
      p.plan_id &&
      (!plan ||
        plan.bom_id !== Number(p.bom_id) ||
        plan.batches !== units(p.batches))
    )
      throw Error(
        "Plan is not scheduled or does not match this BOM and batch count.",
      );
    const dates = batchDates(p);
    const bom = this.get(
      "SELECT * FROM boms WHERE id=? AND active=1",
      Number(p.bom_id),
    );
    if (!bom) throw Error("Select an active BOM.");
    const batches = units(p.batches);
    if (!batches) throw Error("Batch count must be positive.");
    const expected = mul(bom.yield_qty, batches),
      actual = this.quantity(bom.product_id, p.actual, "packet");
    if (!actual)
      required(p.failure_reason, "Failure reason for zero-output run");
    const standards = JSON.parse(bom.components),
      seen = new Set();
    const components = standards.map((c) => {
      const a = (p.components || []).find(
        (x) => Number(x.item_id) === c.item_id,
      );
      if (!a) throw Error("Enter actual consumption for every BOM component.");
      seen.add(c.item_id);
      const qty = this.quantity(c.item_id, a.qty, a.unit),
        planned = mul(c.qty, batches);
      if (qty > this.stock(c.item_id))
        throw Error(
          `Insufficient ${this.get("SELECT name FROM items WHERE id=?", c.item_id).name}.`,
        );
      return {
        item_id: c.item_id,
        planned,
        actual: qty,
        variance: planned ? ((qty - planned) / planned) * 100 : 0,
      };
    });
    if (p.components.length !== seen.size)
      throw Error("Unexpected or duplicate BOM components.");
    if (!components.some((c) => c.actual > 0))
      throw Error("Record material consumption before producing output.");
    const damaged = units(p.damaged || 0);
    if (damaged % 1000) throw Error("Damaged pouches must be whole.");
    const pouch = components.find((c) =>
      this.get("SELECT name FROM items WHERE id=?", c.item_id)
        .name.toLowerCase()
        .includes("pouch"),
    );
    if (pouch && pouch.actual < actual + damaged)
      throw Error(
        "Pouch consumption must include good packets and damaged pouches.",
      );
    const date = dateToday(),
      id = this.insert("runs", {
        date,
        product_id: bom.product_id,
        bom_id: bom.id,
        batch: required(p.batch, "Batch number"),
        expected,
        actual,
        damaged,
        components: JSON.stringify(components),
        labour: money(p.labour || 0),
        power: money(p.power || 0),
        tolerance: Number(
          this.get("SELECT value FROM settings WHERE key='variance_tolerance'")
            .value,
        ),
        gas: money(p.gas || 0),
        other: money(p.other || 0),
        notes:
          String(p.notes || "") +
          (p.failure_reason ? " Failure: " + p.failure_reason : ""),
        user_id: u.id,
      });
    for (const c of components)
      this.movement(
        u,
        date,
        c.item_id,
        -c.actual,
        "production",
        id,
        "Actual material consumption",
      );
    const outputBatch = addBatch(this, {
      item_id: bom.product_id,
      run_id: id,
      code: p.batch,
      qty: actual,
      ...dates,
    });
    this.movement(
      u,
      date,
      bom.product_id,
      actual,
      "production",
      id,
      "Good packets produced",
      0,
      outputBatch,
    );
    if (plan)
      this.exec(
        "UPDATE production_plans SET status='completed',run_id=? WHERE id=?",
        id,
        plan.id,
      );
    this.log(u, "posted", "production", id, p);
    return { id };
  }
  lines(input, admin = false) {
    if (!Array.isArray(input) || !input.length)
      throw Error("Add at least one product.");
    const ids = new Set();
    return input.map((l) => {
      const item = this.get(
        "SELECT * FROM items WHERE id=? AND kind='finished'",
        Number(l.item_id),
      );
      if (!item) throw Error("Unknown product.");
      if (ids.has(item.id))
        throw Error("Combine duplicate products into one line.");
      ids.add(item.id);
      const qty = this.quantity(item.id, l.qty, l.unit),
        price = admin && l.price !== undefined ? money(l.price) : item.price;
      if (!qty || !price) throw Error("Quantity and price must be positive.");
      if (admin && units(l.discount ?? 0, 100) > 10000)
        throw Error("Discount cannot exceed 100%.");
      return {
        item_id: item.id,
        name: item.name,
        hsn: item.hsn,
        gst: item.gst,
        qty,
        price,
        discount: admin ? units(l.discount ?? 0, 100) : 0,
      };
    });
  }
  order(u, p) {
    this.permit(u, ["salesman", "admin"]);
    const c = this.get(
      "SELECT * FROM customers WHERE id=?",
      Number(p.customer_id),
    );
    if (!c) throw Error("Customer not found.");
    if (u.role === "salesman" && c.salesman_id !== u.id)
      throw Error("Customer is assigned to another salesman.");
    for (const line of p.lines || [])
      if (u.role === "salesman" && line.expected_price !== undefined) {
        const item = this.get(
          "SELECT * FROM items WHERE id=?",
          Number(line.item_id),
        );
        if (!item || Number(line.expected_price) !== item.price) {
          const error = Error(
            "Product price changed. Review current prices and submit a new order; this draft was not posted.",
          );
          error.status = 409;
          throw error;
        }
      }
    const id = this.insert("orders", {
      date: dateToday(),
      customer_id: c.id,
      salesman_id: u.role === "salesman" ? u.id : c.salesman_id,
      status: "submitted",
      lines: JSON.stringify(this.lines(p.lines, u.role === "admin")),
      notes: String(p.notes || ""),
    });
    this.log(u, "submitted", "order", id, p);
    return { id };
  }
  approve(u, p) {
    this.permit(u, ["admin"]);
    const o = this.get("SELECT * FROM orders WHERE id=?", Number(p.id));
    if (!o || o.status !== "submitted")
      throw Error("Only submitted orders can be verified.");
    let lines = p.lines ? this.lines(p.lines, true) : JSON.parse(o.lines);
    let backorder_id = null;
    if (p.reject) {
      this.exec(
        "UPDATE orders SET status='rejected',notes=? WHERE id=?",
        required(p.reason, "Rejection reason"),
        o.id,
      );
    } else {
      if (p.partial) {
        if (
          this.get("SELECT value FROM settings WHERE key='fulfillment'")
            .value !== "split"
        )
          throw Error("Enable split fulfillment in Settings first.");
        const remainder = [];
        lines = lines
          .map((l) => {
            const qty = Math.min(l.qty, this.available(l.item_id, o.id));
            if (qty < l.qty) remainder.push({ ...l, qty: l.qty - qty });
            return { ...l, qty };
          })
          .filter((l) => l.qty > 0);
        if (!lines.length)
          throw Error(
            "No stock available to reserve. Order remains submitted.",
          );
        if (remainder.length)
          backorder_id = this.insert("orders", {
            date: dateToday(),
            customer_id: o.customer_id,
            salesman_id: o.salesman_id,
            status: "submitted",
            lines: JSON.stringify(remainder),
            notes: "Backorder from ORD-" + o.id,
            parent_id: o.id,
          });
      }
      for (const l of lines) {
        const avail = this.available(l.item_id, o.id);
        if (avail < l.qty)
          throw Error(
            `Shortage of ${decimal(l.qty - avail)} packets of ${l.name}. Order remains submitted.`,
          );
      }
      this.exec(
        "UPDATE orders SET status='approved',lines=? WHERE id=?",
        JSON.stringify(lines),
        o.id,
      );
    }
    this.log(u, p.reject ? "rejected" : "approved", "order", o.id, {
      before: o,
      after: p,
    });
    this.log(
      u,
      p.reject ? "reservation released" : "reservation created",
      "order",
      o.id,
      { lines, backorder_id },
    );
    return { id: o.id, ...(backorder_id ? { backorder_id } : {}) };
  }
  cancelOrder(u, p) {
    this.permit(u, ["admin"]);
    const o = this.get("SELECT * FROM orders WHERE id=?", Number(p.id));
    if (!o || !["submitted", "approved"].includes(o.status))
      throw Error(
        "Only submitted or approved orders can be cancelled. Use a credit note for invoices.",
      );
    const reason = required(p.reason, "Cancellation reason");
    this.exec("UPDATE orders SET status='cancelled' WHERE id=?", o.id);
    this.log(u, "reservation released", "order", o.id, {
      reason,
      lines: JSON.parse(o.lines),
    });
    return { id: o.id };
  }
  configure(u, p) {
    this.permit(u, ["admin"]);
    if (p.item_id) {
      const item = this.get(
        "SELECT * FROM items WHERE id=?",
        Number(p.item_id),
      );
      if (!item) throw Error("Item not found.");
      this.exec(
        "UPDATE items SET reorder_level=? WHERE id=?",
        this.quantity(item.id, p.reorder_level, item.unit),
        item.id,
      );
      if (p.gst !== undefined) {
        const gst = units(p.gst, 100),
          price = money(p.price ?? item.price / 100);
        if (gst > 10000 || (item.kind === "finished" && !price))
          throw Error(
            "GST must be 0-100%; finished-product price must be positive.",
          );
        this.exec(
          "UPDATE items SET gst=?,price=? WHERE id=?",
          gst,
          price,
          item.id,
        );
      }
    } else {
      if (!["strict", "split"].includes(p.fulfillment))
        throw Error("Choose strict or split fulfillment.");
      const tolerance = units(p.variance_tolerance, 100);
      if (tolerance > 10000)
        throw Error("Tolerance must be between 0 and 100%.");
      this.exec(
        "UPDATE settings SET value=? WHERE key='fulfillment'",
        p.fulfillment,
      );
      this.exec(
        "UPDATE settings SET value=? WHERE key='variance_tolerance'",
        String(tolerance),
      );
    }
    this.log(u, "configured", "settings", 0, p);
    return { ok: true };
  }
  invoice(u, p) {
    this.permit(u, ["admin"]);
    const o = this.get("SELECT * FROM orders WHERE id=?", Number(p.id));
    if (!o || o.status !== "approved")
      throw Error("Only approved orders can be invoiced.");
    const c = this.get("SELECT * FROM customers WHERE id=?", o.customer_id),
      lines = JSON.parse(o.lines);
    let taxable = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    for (const l of lines) {
      l.gross = mul(l.qty, l.price);
      l.discount_amount = mul(l.gross, l.discount || 0, 10000);
      l.taxable = l.gross - l.discount_amount;
      taxable += l.taxable;
      if (c.state === "Tamil Nadu") {
        l.cgst = mul(l.taxable, l.gst, 20000);
        l.sgst = l.cgst;
        l.igst = 0;
      } else {
        l.igst = mul(l.taxable, l.gst, 10000);
        l.cgst = l.sgst = 0;
      }
      cgst += l.cgst;
      sgst += l.sgst;
      igst += l.igst;
    }
    const date = dateToday(),
      prefix = `GL/${fy(date)}/`,
      seq =
        Number(
          this.get(
            "SELECT COUNT(*) AS n FROM invoices WHERE number LIKE ?",
            prefix + "%",
          ).n,
        ) + 1;
    const due = new Date(date + "T00:00:00Z");
    due.setUTCDate(due.getUTCDate() + 30);
    const id = this.insert("invoices", {
      number: prefix + String(seq).padStart(4, "0"),
      date,
      order_id: o.id,
      customer_id: c.id,
      lines: JSON.stringify(lines),
      taxable,
      cgst,
      sgst,
      igst,
      total: taxable + cgst + sgst + igst,
      status: "posted",
      due_date: due.toISOString().slice(0, 10),
    });
    this.exec("UPDATE orders SET status='invoiced' WHERE id=?", o.id);
    this.log(u, "posted", "invoice", id, { order: o.id });
    return { id };
  }
  dispatch(u, p) {
    this.permit(u, ["admin"]);
    const inv = this.get("SELECT * FROM invoices WHERE id=?", Number(p.id));
    if (!inv || inv.status !== "posted" || inv.dispatched)
      throw Error("Invoice must be posted and not yet dispatched.");
    const allocations = dispatchPlan(this, inv);
    if (
      p.expected_batches &&
      JSON.stringify(p.expected_batches) !==
        JSON.stringify(
          allocations.map((a) => ({ batch_id: a.batch_id, qty: a.qty })),
        )
    )
      throw Error(
        "Batch availability changed. Reopen the dispatch preview and pick the updated batches.",
      );
    for (const a of allocations)
      this.insert("batch_allocations", {
        invoice_id: inv.id,
        batch_id: a.batch_id,
        qty: a.qty,
        date: dateToday(),
      });
    for (const l of JSON.parse(inv.lines))
      this.movement(
        u,
        dateToday(),
        l.item_id,
        -l.qty,
        "dispatch",
        inv.id,
        inv.number,
      );
    this.exec("UPDATE invoices SET dispatched=1 WHERE id=?", inv.id);
    this.exec("UPDATE orders SET status='dispatched' WHERE id=?", inv.order_id);
    this.log(u, "reservation consumed", "order", inv.order_id, {
      invoice_id: inv.id,
    });
    this.log(u, "dispatched", "invoice", inv.id, {
      ...p,
      batches: allocations,
    });
    return { id: inv.id };
  }
  payment(u, p) {
    this.permit(u, ["admin", "accountant"]);
    const inv = this.get(
      "SELECT * FROM invoices WHERE id=? AND status='posted'",
      Number(p.invoice_id),
    );
    if (!inv) throw Error("Select a posted invoice.");
    const paid = this.get(
        "SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id=?",
        inv.id,
      ).paid,
      amount = money(p.amount);
    if (!amount || amount > inv.total - paid)
      throw Error("Payment must be positive and no greater than outstanding.");
    if (
      this.get(
        "SELECT id FROM payments WHERE invoice_id=? AND reference=?",
        inv.id,
        required(p.reference, "Payment reference"),
      )
    )
      throw Error(
        "This payment reference is already recorded for the invoice.",
      );
    const id = this.insert("payments", {
      date: dateToday(),
      invoice_id: inv.id,
      amount,
      reference: required(p.reference, "Payment reference"),
      user_id: u.id,
    });
    this.log(u, "received", "payment", id, p);
    return { id };
  }
  overhead(u, p) {
    this.permit(u, ["production", "admin"]);
    const r = this.get("SELECT * FROM runs WHERE id=?", Number(p.id));
    if (!r) throw Error("Run not found.");
    const labour = money(p.labour),
      power = money(p.power);
    const gas = money(p.gas ?? (r.gas || 0) / 100),
      other = money(p.other ?? (r.other || 0) / 100);
    this.exec(
      "UPDATE runs SET labour=?,power=?,gas=?,other=? WHERE id=?",
      labour,
      power,
      gas,
      other,
      r.id,
    );
    this.log(u, "overheads amended", "production", r.id, {
      before: { labour: r.labour, power: r.power },
      after: { labour, power },
      categories: {
        before: { gas: r.gas, other: r.other },
        after: { gas, other },
      },
      reason: required(p.reason, "Amendment reason"),
    });
    return { id: r.id };
  }
  credit(u, p) {
    this.permit(u, ["admin"]);
    const inv = this.get(
      "SELECT * FROM invoices WHERE id=? AND status='posted'",
      Number(p.id),
    );
    if (!inv) throw Error("Invoice not found.");
    if (inv.dispatched)
      throw Error(
        "Dispatched invoice cancellation requires a returns workflow, outside this prototype.",
      );
    if (this.get("SELECT id FROM payments WHERE invoice_id=?", inv.id))
      throw Error(
        "Cannot cancel an invoice with collections; refund workflow is outside this prototype.",
      );
    const id = this.insert("credits", {
      date: dateToday(),
      number: "CN/" + inv.number,
      invoice_id: inv.id,
      amount: inv.total,
      reason: required(p.reason, "Credit note reason"),
      user_id: u.id,
    });
    this.exec("UPDATE invoices SET status='credited' WHERE id=?", inv.id);
    this.exec("UPDATE orders SET status='cancelled' WHERE id=?", inv.order_id);
    this.log(u, "reservation released", "order", inv.order_id, {
      credit_id: id,
    });
    this.log(u, "credited", "invoice", inv.id, p);
    return { id };
  }
  master(u, p) {
    this.permit(u, ["admin"]);
    let id;
    if (p.type === "item") {
      if (
        !["raw", "packaging", "finished"].includes(p.kind) ||
        !["kg", "litre", "piece", "packet"].includes(p.unit)
      )
        throw Error("Invalid item category or unit.");
      if (
        p.kind === "finished" &&
        (p.unit !== "packet" || money(p.price || 0) === 0)
      )
        throw Error(
          "Finished products require packet units and a positive list price.",
        );
      if (units(p.gst ?? 5, 100) > 10000 || !units(p.carton_size ?? 20, 1))
        throw Error(
          "Enter a GST percentage between 0 and 100 and a positive carton size.",
        );
      id = this.insert("items", {
        name: required(p.name, "Item name"),
        kind: p.kind,
        unit: p.unit,
        price: money(p.price || 0),
        hsn: required(p.hsn, "HSN"),
        gst: units(p.gst ?? 5, 100),
        carton_size: units(p.carton_size ?? 20, 1),
      });
    } else if (p.type === "customer") {
      const salesperson = this.get(
        "SELECT id FROM users WHERE id=? AND role='salesman'",
        Number(p.salesman_id),
      );
      if (!salesperson) throw Error("Select a salesman.");
      id = this.insert("customers", {
        name: required(p.name, "Customer name"),
        state: required(p.state, "State"),
        gstin: String(p.gstin || ""),
        address: required(p.address, "Address"),
        salesman_id: salesperson.id,
      });
    } else if (p.type === "supplier")
      id = this.insert("suppliers", {
        name: required(p.name, "Supplier name"),
        gstin: String(p.gstin || ""),
      });
    else if (p.type === "bom") {
      const product = this.get(
        "SELECT id FROM items WHERE id=? AND kind='finished'",
        Number(p.product_id),
      );
      if (!product) throw Error("Select a finished product.");
      const components = (p.components || []).map((c) => {
        const i = this.get(
          "SELECT * FROM items WHERE id=? AND kind<>'finished'",
          Number(c.item_id),
        );
        if (!i) throw Error("BOM components must be materials.");
        const qty = this.quantity(i.id, c.qty, c.unit);
        if (!qty) throw Error("BOM quantity must be positive.");
        return { item_id: i.id, qty };
      });
      const yield_qty = this.quantity(product.id, p.yield, "packet");
      if (
        !yield_qty ||
        !components.length ||
        new Set(components.map((c) => c.item_id)).size !== components.length
      )
        throw Error("Provide positive yield and unique components.");
      id = this.insert("boms", {
        product_id: product.id,
        name: required(p.name, "Recipe name"),
        yield_qty,
        components: JSON.stringify(components),
      });
    } else throw Error("Unknown master type.");
    this.log(u, "created", p.type, id, p);
    return { id };
  }
  act(u, action, p, key) {
    const methods = [
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
      "cancelOrder",
      "configure",
      "approvePlan",
      "cancelPlan",
      "financialCredit",
      "returnGoods",
      "refund",
      "adjustment",
    ];
    if (!methods.includes(action)) throw Error("Unknown action.");
    if (typeof key !== "string" || !key.trim() || key.length > 100)
      throw Error("An idempotency key is required.");
    if (!p || typeof p !== "object" || Array.isArray(p))
      throw Error("Transaction data must be a JSON object.");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ action, data: canonical(p) }))
      .digest("hex");
    return this.atomic(() => {
      const old = this.get(
        "SELECT result,fingerprint FROM requests WHERE user_id=? AND key=?",
        u.id,
        key,
      );
      if (old) {
        if (!old.fingerprint)
          throw Error(
            "This older request was already processed. Refresh and verify its record before submitting anything new.",
          );
        if (old.fingerprint !== fingerprint) {
          const error = Error(
            "This submission ID was used for a different request. Refresh and verify the previous record.",
          );
          error.status = 409;
          throw error;
        }
        return JSON.parse(old.result);
      }
      const result = this[action](u, p);
      this.insert("requests", {
        user_id: u.id,
        key,
        result: JSON.stringify(result),
        fingerprint,
      });
      return result;
    });
  }
  snapshot(u) {
    const sales = u.role === "salesman";
    const orders = this.all(
      `SELECT o.*,c.name AS customer,c.state,u.name AS salesman FROM orders o JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=o.salesman_id ${sales ? "WHERE o.salesman_id=?" : ""} ORDER BY o.id DESC`,
      ...(sales ? [u.id] : []),
    ).map((o) => ({
      ...o,
      lines: JSON.parse(o.lines).map((l) => ({
        ...l,
        available: this.available(l.item_id, o.id),
      })),
    }));
    const base = {
      user: { id: u.id, name: u.name, role: u.role },
      today: dateToday(),
      items: this.all(
        `SELECT ${sales ? "id,name,unit,price,hsn,gst,carton_size" : "*"} FROM items ${sales ? "WHERE kind='finished'" : ""}`,
      ),
      customers: this.all(
        `SELECT * FROM customers ${sales ? "WHERE salesman_id=?" : ""}`,
        ...(sales ? [u.id] : []),
      ),
      orders,
    };
    if (sales) return base;
    const valuation = this.valuation();
    const invoices = this.all(
      "SELECT i.*,c.name AS customer,c.state,c.gstin,c.address,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.id DESC",
    ).map((i) => ({
      ...i,
      lines: JSON.parse(i.lines),
      outstanding: i.status === "credited" ? 0 : i.total - i.paid,
    }));
    const result = {
      ...base,
      ...valuation,
      settings: Object.fromEntries(
        this.all("SELECT * FROM settings").map((x) => [x.key, x.value]),
      ),
      plans: this.all(
        "SELECT p.*,i.name AS product,b.name AS bom FROM production_plans p JOIN items i ON i.id=p.product_id JOIN boms b ON b.id=p.bom_id ORDER BY p.id DESC",
      ),
      planner: productionPlanner(this),
      alerts: inventoryAlerts(this),
      batches: this.batches(),
      batch_trace: u.role === "production" ? [] : batchTrace(this),
      stock: valuation.stock.map((s) => ({
        ...s,
        available: this.available(s.id),
        reserved: this.reserved(s.id),
        held: s.qty - usableStock(this, s.id),
      })),
      boms: this.all("SELECT * FROM boms").map((b) => ({
        ...b,
        components: JSON.parse(b.components),
      })),
      suppliers: this.all("SELECT * FROM suppliers"),
      salesmen: this.all("SELECT id,name FROM users WHERE role='salesman'"),
      invoices,
      purchases: this.all(
        "SELECT p.*,s.name AS supplier,i.name AS item FROM purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN items i ON i.id=p.item_id ORDER BY p.id DESC",
      ),
      payments: this.all(
        "SELECT p.*,i.number,c.name AS customer FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id ORDER BY p.id DESC",
      ),
      credits: this.all("SELECT * FROM credits"),
      refunds: this.all("SELECT * FROM refunds"),
      returns: this.all("SELECT * FROM stock_returns"),
      adjustments: this.all("SELECT * FROM adjustments"),
      reconciliation: u.role === "production" ? null : reconcile(this),
      audit: this.all(
        "SELECT a.*,u.name AS user FROM audit a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200",
      ),
    };
    if (u.role === "production") {
      result.orders = [];
      result.customers = [];
      delete result.invoices;
      delete result.payments;
      delete result.credits;
      delete result.refunds;
      delete result.returns;
      delete result.reconciliation;
      delete result.audit;
      delete result.salesmen;
    }
    return result;
  }
  dashboard(u, from, to) {
    return dashboard(this, u, from, to);
  }
  report(u, type, from, to, filters = {}) {
    this.permit(u, ["admin", "accountant", "auditor", "owner"]);
    validDate(from);
    validDate(to);
    if (from > to) throw Error("Start date must precede end date.");
    if (
      filters.batch_id &&
      [
        "stock",
        "raw-stock",
        "packaging-stock",
        "finished-stock",
        "ledger",
        "purchases",
        "reconciliation",
      ].includes(type)
    )
      throw Error(
        "This report reconciles item totals. Use Batch expiry, production or costing for batch filters.",
      );
    const extra = extraReport(this, type, from, to, filters);
    if (extra !== null) return { type, from, to, rows: extra };
    const originalType = type;
    const category = {
      "raw-stock": "raw",
      "packaging-stock": "packaging",
      "finished-stock": "finished",
    }[type];
    if (category) type = "stock";
    const s = filterSnapshot(this, this.snapshot(u), filters),
      within = (x) => x.date >= from && x.date <= to;
    let rows = [];
    if (type === "sales")
      rows = s.invoices.filter(within).flatMap((i) =>
        i.lines.map((l) => ({
          Date: i.date,
          Invoice: i.number,
          Customer: i.customer,
          State: i.state,
          Status: i.status,
          Product: l.name,
          HSN: l.hsn,
          Packets: decimal(l.qty),
          Taxable_INR: rupees(l.taxable),
          CGST_INR: rupees(l.cgst),
          SGST_INR: rupees(l.sgst),
          IGST_INR: rupees(l.igst),
        })),
      );
    else if (type === "customer-sales" || type === "product-sales") {
      const groups = new Map();
      const add = (i, l, sign) => {
        const key = type === "customer-sales" ? i.customer : l.name;
        const g = groups.get(key) || {
          Name: key,
          Packets: 0,
          Taxable_INR: 0,
          GST_INR: 0,
        };
        g.Packets += sign * l.qty;
        g.Taxable_INR += sign * l.taxable;
        g.GST_INR += sign * (l.cgst + l.sgst + l.igst);
        groups.set(key, g);
      };
      s.invoices
        .filter(within)
        .forEach((i) => i.lines.forEach((l) => add(i, l, 1)));
      s.credits.filter(within).forEach((c) => {
        const i = s.invoices.find((i) => i.id === c.invoice_id);
        i.lines.forEach((l) => add(i, l, -1));
      });
      rows = [...groups.values()].map((g) => ({
        ...g,
        Packets: decimal(g.Packets),
        Taxable_INR: rupees(g.Taxable_INR),
        GST_INR: rupees(g.GST_INR),
      }));
    } else if (type === "gst")
      rows = [
        ...s.invoices.filter(within).map((i) => ({
          Date: i.date,
          Document: i.number,
          Type: "Outward supply",
          GSTIN: i.gstin,
          Place_of_supply: i.state,
          Taxable_INR: rupees(i.taxable),
          CGST_INR: rupees(i.cgst),
          SGST_INR: rupees(i.sgst),
          IGST_INR: rupees(i.igst),
        })),
        ...s.credits.filter(within).map((c) => {
          const i = s.invoices.find((i) => i.id === c.invoice_id);
          return {
            Date: c.date,
            Document: c.number,
            Type: "Credit note",
            GSTIN: i.gstin,
            Place_of_supply: i.state,
            Taxable_INR: rupees(-i.taxable),
            CGST_INR: rupees(-i.cgst),
            SGST_INR: rupees(-i.sgst),
            IGST_INR: rupees(-i.igst),
          };
        }),
      ];
    else if (type === "purchases")
      rows = s.purchases.filter(within).map((p) => ({
        Date: p.date,
        Purchase: `PUR-${p.id}`,
        Supplier: p.supplier,
        Reference: p.reference,
        Item: p.item,
        Quantity: decimal(p.qty),
        Net_cost_INR: rupees(p.amount),
      }));
    else if (type === "ledger")
      rows = s.ledger.filter(within).map((m) => ({
        Movement_ID: m.id,
        Date: m.date,
        Posted_at: m.posted_at || "Legacy: see business date and audit trail",
        Responsible_user:
          this.get("SELECT name FROM users WHERE id=?", m.user_id)?.name ||
          "Unknown",
        Batch_ID:
          m.batch_id ||
          (m.source === "dispatch"
            ? this.all(
                "SELECT batch_id FROM batch_allocations WHERE invoice_id=?",
                m.source_id,
              )
                .map((b) => b.batch_id)
                .join(", ")
            : ""),
        Item: m.item,
        Unit: m.unit,
        Movement: decimal(m.qty),
        Source: `${m.source} #${m.source_id}`,
        Note: m.note,
        Balance: decimal(m.balance),
        Movement_value_INR: rupees(m.value),
        Stock_value_INR: rupees(m.stock_value),
      }));
    else if (type === "stock")
      rows = s.stock.map((i) => {
        const ms = s.ledger.filter((m) => m.item_id === i.id && m.date <= to),
          opening = ms
            .filter((m) => m.date < from)
            .reduce((a, m) => a + m.qty, 0),
          period = ms.filter(within),
          last = ms.at(-1);
        return {
          Item: i.name,
          Category: i.kind,
          Unit: i.unit,
          Opening: decimal(opening),
          Receipts: decimal(
            period.filter((m) => m.qty > 0).reduce((a, m) => a + m.qty, 0),
          ),
          Issues: decimal(
            -period.filter((m) => m.qty < 0).reduce((a, m) => a + m.qty, 0),
          ),
          Closing: decimal(last?.balance || 0),
          Value_INR: rupees(last?.stock_value || 0),
        };
      });
    else if (type === "production")
      rows = s.runs.filter(within).flatMap((r) =>
        r.components.map((c) => ({
          Date: r.date,
          Run: `RUN-${r.id}`,
          Batch: r.batch,
          Product: s.items.find((i) => i.id === r.product_id).name,
          Material: s.items.find((i) => i.id === c.item_id).name,
          Planned: decimal(c.planned),
          Actual: decimal(c.actual),
          Consumption_variance_pct: c.variance.toFixed(2),
          Expected_packets: decimal(r.expected),
          Good_packets: decimal(r.actual),
          Yield_variance_pct: r.yield_variance.toFixed(2),
          Damaged_pouches: decimal(r.damaged),
          Material_cost_INR: rupees(r.material),
          Labour_INR: rupees(r.labour),
          Power_INR: rupees(r.power),
          Run_cost_INR: rupees(r.total),
          Cost_per_packet_INR: rupees(r.cost_per_packet),
        })),
      );
    else if (type === "collections")
      rows = s.payments.filter(within).map((p) => ({
        Date: p.date,
        Invoice: p.number,
        Customer: p.customer,
        Reference: p.reference,
        Received_INR: rupees(p.amount),
      }));
    else if (type === "outstanding")
      rows = s.invoices
        .filter((i) => i.date <= to)
        .map((i) => {
          const credited = s.credits.some(
              (c) => c.invoice_id === i.id && c.date <= to,
            ),
            paid = s.payments
              .filter((p) => p.invoice_id === i.id && p.date <= to)
              .reduce((a, p) => a + p.amount, 0),
            amount = credited ? 0 : i.total - paid,
            days = Math.max(
              0,
              Math.floor((new Date(to) - new Date(i.due_date)) / 86400000),
            );
          return {
            Invoice: i.number,
            Customer: i.customer,
            Due_date: i.due_date,
            Invoice_INR: rupees(i.total),
            Paid_INR: rupees(paid),
            Outstanding_INR: rupees(amount),
            Days_overdue: days,
            Ageing:
              days === 0
                ? "Current"
                : days <= 30
                  ? "1-30 days"
                  : days <= 60
                    ? "31-60 days"
                    : days <= 90
                      ? "61-90 days"
                      : "90+ days",
          };
        });
    else throw Error("Unknown report.");
    if (category) rows = rows.filter((r) => r.Category === category);
    return { type: originalType, from, to, rows };
  }
}
