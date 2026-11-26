// Additive, transactional migrations. Existing business records are never reseeded.
import { passwordHash } from "./domain.js";
export function migrate(f) {
  f.atomic(() => {
    const add = (table, name, definition) => {
      if (!f.all(`PRAGMA table_info(${table})`).some((c) => c.name === name))
        f.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    add("orders", "parent_id", "INTEGER REFERENCES orders(id)");
    add(
      "items",
      "reorder_level",
      "INTEGER NOT NULL DEFAULT 0 CHECK(reorder_level>=0)",
    );
    add("runs", "gas", "INTEGER NOT NULL DEFAULT 0 CHECK(gas>=0)");
    add("runs", "other", "INTEGER NOT NULL DEFAULT 0 CHECK(other>=0)");
    add("movements", "posted_at", "TEXT NOT NULL DEFAULT ''");
    add("movements", "batch_id", "INTEGER REFERENCES stock_batches(id)");
    add("movements", "frozen_value", "INTEGER");
    f.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO settings VALUES('fulfillment','strict'),('variance_tolerance','300');
      CREATE TABLE IF NOT EXISTS production_plans(
        id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES items(id),bom_id INTEGER NOT NULL REFERENCES boms(id),
        batches INTEGER NOT NULL CHECK(batches>0),expected INTEGER NOT NULL CHECK(expected>0),
        scheduled_on TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('scheduled','completed','cancelled')),
        run_id INTEGER UNIQUE REFERENCES runs(id),user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,notes TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS adjustments(
        id INTEGER PRIMARY KEY,date TEXT NOT NULL,item_id INTEGER NOT NULL REFERENCES items(id),batch_id INTEGER REFERENCES stock_batches(id),
        qty INTEGER NOT NULL CHECK(qty<>0),amount INTEGER NOT NULL,kind TEXT NOT NULL,reason TEXT NOT NULL,
        reverses_id INTEGER UNIQUE REFERENCES adjustments(id),user_id INTEGER NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS stock_returns(
        id INTEGER PRIMARY KEY,date TEXT NOT NULL,invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
        reason TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS refunds(
        id INTEGER PRIMARY KEY,date TEXT NOT NULL,invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        amount INTEGER NOT NULL CHECK(amount>0),reference TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL REFERENCES users(id));
      CREATE INDEX IF NOT EXISTS order_status ON orders(status);
      CREATE INDEX IF NOT EXISTS payment_invoice ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS plan_status ON production_plans(status,product_id);
      CREATE INDEX IF NOT EXISTS movement_source ON movements(source,source_id,item_id);
      CREATE TRIGGER IF NOT EXISTS nonnegative_inventory BEFORE INSERT ON movements WHEN NEW.qty<0
      BEGIN SELECT CASE WHEN COALESCE((SELECT SUM(qty) FROM movements WHERE item_id=NEW.item_id),0)+NEW.qty<0
        THEN RAISE(ABORT,'Insufficient stock: negative inventory blocked') END; END;
      CREATE TRIGGER IF NOT EXISTS immutable_movement_update BEFORE UPDATE ON movements
        BEGIN SELECT RAISE(ABORT,'Posted stock movements are immutable; use a reversal'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_movement_delete BEFORE DELETE ON movements
        BEGIN SELECT RAISE(ABORT,'Posted stock movements are immutable; use a reversal'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_invoice_amounts BEFORE UPDATE OF lines,taxable,cgst,sgst,igst,total,number,order_id,customer_id ON invoices
        BEGIN SELECT RAISE(ABORT,'Posted invoices are immutable; use a credit note'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_run_quantities BEFORE UPDATE OF product_id,bom_id,expected,actual,damaged,components ON runs
        BEGIN SELECT RAISE(ABORT,'Posted production quantities are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_bom_recipe BEFORE UPDATE OF product_id,yield_qty,components ON boms
        BEGIN SELECT RAISE(ABORT,'Create a new BOM version'); END;
      CREATE TRIGGER IF NOT EXISTS valid_payment BEFORE INSERT ON payments
        BEGIN SELECT CASE WHEN NEW.amount<=0 OR NEW.amount IS NULL OR typeof(NEW.amount)<>'integer'
          THEN RAISE(ABORT,'Payment must be a positive integer paisa amount') END; END;
      CREATE TRIGGER IF NOT EXISTS immutable_payment_amount BEFORE UPDATE OF amount,invoice_id,reference ON payments
        BEGIN SELECT RAISE(ABORT,'Posted collections are immutable'); END;
    `);
    // Old demo "auditor" had an accountant role but was read-only. Preserve that access.
    f.exec(
      "UPDATE users SET role='auditor',name='Read-only Auditor' WHERE username='auditor' AND role='accountant'",
    );
    if (!f.get("SELECT id FROM users WHERE username='accountant'"))
      f.insert("users", {
        name: "Accountant",
        username: "accountant",
        role: "accountant",
        password: passwordHash("Demo@12345"),
      });
    f.db.exec("PRAGMA user_version=3");
  });
}
