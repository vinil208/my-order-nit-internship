import { dateToday, validDate, required, mul, decimal } from "./domain.js";

// Pure recommendations from authoritative demand, reservations and approved schedules.
export function productionPlanner(f) {
  const valuation = f.valuation(),
    orders = f.all("SELECT * FROM orders WHERE status='submitted' ORDER BY id"),
    schedules = f.all(
      "SELECT * FROM production_plans WHERE status='scheduled' ORDER BY scheduled_on,id",
    );
  const materialPool = new Map(valuation.stock.map((s) => [s.id, s.qty]));
  // Scheduled jobs consume capacity in date order, without pretending those materials are reserved.
  for (const plan of schedules) {
    const bom = f.get("SELECT * FROM boms WHERE id=?", plan.bom_id);
    for (const c of JSON.parse(bom.components))
      materialPool.set(
        c.item_id,
        (materialPool.get(c.item_id) || 0) - mul(c.qty, plan.batches),
      );
  }
  return valuation.stock
    .filter((i) => i.kind === "finished")
    .map((product) => {
      const demand = orders.reduce(
        (sum, o) =>
          sum +
          JSON.parse(o.lines)
            .filter((l) => l.item_id === product.id)
            .reduce((a, l) => a + l.qty, 0),
        0,
      );
      const reserved = f.reserved(product.id),
        available = f.available(product.id);
      const eligible = f
        .batches()
        .filter((b) => b.item_id === product.id && b.eligible)
        .reduce((a, b) => a + b.remaining, 0);
      const reservationDeficit = Math.max(0, reserved - eligible);
      const scheduled = schedules
        .filter((p) => p.product_id === product.id)
        .reduce((a, p) => a + p.expected, 0);
      const shortage = Math.max(
        0,
        demand + reservationDeficit - available - scheduled,
      );
      const bom = f.get(
        "SELECT * FROM boms WHERE product_id=? AND active=1 ORDER BY id DESC LIMIT 1",
        product.id,
      );
      const batches = bom ? Math.ceil(shortage / bom.yield_qty) : 0;
      const materials = bom
        ? JSON.parse(bom.components).map((c) => {
            const stock = valuation.stock.find((s) => s.id === c.item_id),
              required = c.qty * batches,
              free = Math.max(0, materialPool.get(c.item_id) || 0),
              purchase_qty = Math.max(0, required - free);
            materialPool.set(
              c.item_id,
              (materialPool.get(c.item_id) || 0) - required,
            );
            return {
              item_id: c.item_id,
              name: stock.name,
              unit: stock.unit,
              required,
              available: free,
              purchase_qty,
              estimated_cost: stock.qty
                ? mul(stock.value, required, stock.qty)
                : null,
            };
          })
        : [];
      const expected = bom ? bom.yield_qty * batches : 0;
      const materialCost = materials.some((m) => m.estimated_cost === null)
        ? null
        : materials.reduce((a, m) => a + m.estimated_cost, 0);
      const previous = valuation.runs
        .filter((r) => r.product_id === product.id && r.actual > 0)
        .at(-1);
      const estimatedOverheads = previous
        ? mul(
            previous.labour + previous.power + previous.gas + previous.other,
            expected,
            previous.expected,
          )
        : null;
      return {
        product_id: product.id,
        product: product.name,
        bom_id: bom?.id || null,
        bom_name: bom?.name || "",
        pending_demand: demand,
        reserved,
        available,
        scheduled,
        reservation_deficit: reservationDeficit,
        shortage,
        batches,
        expected,
        materials,
        estimated_material_cost: materialCost,
        estimated_overheads: estimatedOverheads,
        estimated_production_cost:
          materialCost === null || estimatedOverheads === null
            ? null
            : materialCost + estimatedOverheads,
        overhead_basis_run: previous?.id || null,
        priority: reservationDeficit ? "Urgent" : shortage ? "High" : "Normal",
      };
    });
}

export function approvePlan(f, u, p) {
  f.permit(u, ["admin"]);
  const recommendation = productionPlanner(f).find(
    (r) => r.product_id === Number(p.product_id),
  );
  if (!recommendation?.batches)
    throw Error(
      "No additional production is needed, or no active BOM exists. Refresh the planner.",
    );
  if (
    Number(p.batches) !== recommendation.batches ||
    Number(p.bom_id) !== recommendation.bom_id
  )
    throw Error(
      "Demand or BOM changed. Refresh the production recommendation.",
    );
  const scheduled_on = validDate(required(p.scheduled_on, "Scheduled date"));
  if (scheduled_on < dateToday())
    throw Error("Schedule cannot be in the past.");
  const id = f.insert("production_plans", {
    product_id: recommendation.product_id,
    bom_id: recommendation.bom_id,
    batches: recommendation.batches * 1000,
    expected: recommendation.expected,
    scheduled_on,
    status: "scheduled",
    run_id: null,
    user_id: u.id,
    created_at: new Date().toISOString(),
    notes: String(p.notes || ""),
  });
  f.log(u, "schedule approved", "production_plan", id, recommendation);
  return { id };
}
export function cancelPlan(f, u, p) {
  f.permit(u, ["admin"]);
  const plan = f.get(
    "SELECT * FROM production_plans WHERE id=? AND status='scheduled'",
    Number(p.id),
  );
  if (!plan) throw Error("Only scheduled plans can be cancelled.");
  const reason = required(p.reason, "Cancellation reason");
  f.exec("UPDATE production_plans SET status='cancelled' WHERE id=?", plan.id);
  f.log(u, "schedule cancelled", "production_plan", plan.id, { reason });
  return { id: plan.id };
}
export function inventoryAlerts(f) {
  const low = f
    .valuation()
    .stock.filter(
      (i) => i.reorder_level > 0 && f.available(i.id) <= i.reorder_level,
    )
    .map((i) => ({
      kind: "Low stock",
      item_id: i.id,
      item: i.name,
      detail: `${decimal(f.available(i.id))} ${i.unit} available; reorder level ${decimal(i.reorder_level)}`,
      purchase_qty: Math.max(0, i.reorder_level - f.available(i.id)),
    }));
  const expiry = f
    .batches()
    .filter((b) => b.remaining > 0 && b.status !== "Ready")
    .map((b) => ({
      kind: b.status,
      item_id: b.item_id,
      item: b.product,
      batch_id: b.id,
      detail: `${b.code}: ${decimal(b.remaining)} ${b.unit}; expiry ${b.expires_on || "unverified"}`,
    }));
  return [...low, ...expiry];
}
