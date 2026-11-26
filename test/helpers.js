import { Factory, dateToday } from "../domain.js";
export const today = dateToday();
export const day = (n) => {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function setup(f = new Factory()) {
  let seq = 0;
  const user = (id) => f.get("SELECT * FROM users WHERE id=?", id);
  const act = (id, action, p, key) =>
    f.act(user(id), action, p, key || `full-${++seq}`);
  const order = (qty = 10, customer = 1) =>
    act(customer === 2 ? 4 : 3, "order", {
      customer_id: customer,
      lines: [{ item_id: 6, qty }],
    });
  const invoice = (qty = 10, customer = 1) => {
    const o = order(qty, customer);
    act(1, "approve", o);
    return act(1, "invoice", o);
  };
  const production = (extra = {}) => ({
    bom_id: 1,
    batches: 1,
    batch: `LOT-${++seq}`,
    manufactured_on: today,
    expires_on: day(10),
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
  const counts = () =>
    Object.fromEntries(
      [
        "movements",
        "runs",
        "orders",
        "invoices",
        "payments",
        "credits",
        "audit",
        "requests",
        "stock_batches",
        "batch_allocations",
      ].map((t) => [t, f.get(`SELECT COUNT(*) n FROM ${t}`).n]),
    );
  return { f, user, act, order, invoice, production, counts };
}
