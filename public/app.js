import { AssistantPanel } from "/assistant-ui.js";
const app = document.querySelector("#app"),
  modal = document.querySelector("#modal");
let state = null,
  page = "overview",
  stockTab = "stock",
  report = null,
  reportType = "sales",
  from = "",
  to = "";
const e = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const q = (n) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(
    (n || 0) / 1000,
  );
const rs = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((n || 0) / 100);
const pct = (n) => `${n > 0 ? "+" : ""}${Number(n).toFixed(1)}%`;
const icon = (name) => {
  const paths = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    orders: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
    production: "M3 21V9l6 3V6l6 3V3h6v18z M6 17h2 M12 17h2 M18 17h1",
    inventory: "M3 7l9-4 9 4v11l-9 4-9-4z M3 7l9 5 9-5 M12 12v10",
    purchases: "M3 4h3l3 12h10l2-8H7 M10 21h1 M18 21h1",
    invoices: "M5 3h14v18l-3-2-4 2-4-2-3 2z M8 8h8 M8 12h8",
    reports: "M4 21V3 M4 21h17 M8 17v-6 M13 17V7 M18 17V4",
    masters: "M12 3v18 M3 12h18 M5 5h14v14H5z",
    audit: "M12 3l9 4v6c0 5-9 9-9 9S3 18 3 13V7z M8 12l3 3 5-6",
    benchmark: "M8 3h8v4h4v14H4V7h4z M8 12l2 2 5-5",
    assistant: "M4 4h16v12H9l-5 4z M8 9h8 M8 12h5",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.inventory}"/></svg>`;
};
const badge = (text, type) =>
  `<span class="badge ${type || { submitted: "warn", approved: "blue", invoiced: "blue", dispatched: "good", posted: "good", rejected: "bad", credited: "bad", cancelled: "bad" }[text] || ""}">${e(text)}</span>`;
const btn = (label, action, id = "", style = "") =>
  `<button class="btn ${style}" data-action="${action}" data-id="${id}">${label}</button>`;
const heading = (eyebrow, title, subtitle, action = "") =>
  `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
const panel = (title, subtitle, content, action = "") =>
  `<section class="panel"><div class="panelhead"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${action}</div>${content}</section>`;
const empty = (title, desc) =>
  `<div class="empty"><strong>${title}</strong>${desc}</div>`;
const table = (heads, rows) =>
  rows.length
    ? `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : empty("Nothing here yet", "Your recorded transactions will appear here.");
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const select = (label, name, options, value = "") =>
  `<label>${label}<select name="${name}">${options.map((o) => `<option value="${e(o[0])}" ${String(value) === String(o[0]) ? "selected" : ""}>${e(o[1])}</option>`).join("")}</select></label>`;
const num = (label, name, value = "0", step = "0.001") =>
  field(label, name, value, "number", `min="0" step="${step}" required`);
const itemName = (id) => state.items.find((i) => i.id === id)?.name || "Item";
const can = (...roles) => roles.includes(state.user.role);
const queue = () => JSON.parse(localStorage.getItem("grain-queue") || "[]");
function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (node.style.display = "none"), 5000);
}
async function api(path, body, key) {
  const response = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body
      ? {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const err = Error(data.error || "Request failed");
    err.status = response.status;
    throw err;
  }
  return data;
}
async function refresh() {
  state = await api("state");
  if (state.user.role === "salesman")
    localStorage.setItem("grain-sales-cache", JSON.stringify(state));
  else localStorage.removeItem("grain-sales-cache");
  if (!from) {
    from = state.today.slice(0, 7) + "-01";
    to = state.today;
  }
  if (!["salesman", "production"].includes(state.user.role))
    dashboardData = await api("dashboard?" + new URLSearchParams({ from, to }));
  render();
}
const factoryAssistant = new AssistantPanel({
  api,
  escape: e,
  repaint: () => {
    if (state && page === "assistant") render();
  },
  navigate: (target) => {
    if (navigation().some((n) => n[0] === target)) {
      page = target;
      render();
    }
  },
});
function login() {
  factoryAssistant.reset();
  app.innerHTML = `<main class="login"><section class="login-story"><div class="brand"><img src="/icon.svg" alt=""><div>My Order</div></div><div><h1>Every packet.<br>Every rupee.<br><span>Accounted for.</span></h1><p>A single workspace for the orders, production, and people that keep your factory moving.</p><div class="grain-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div><footer>BUILT FOR SMALL FOOD MANUFACTURERS</footer></section><section class="login-form"><div class="login-box"><div class="eyebrow">Your factory, connected</div><h1>Welcome to the floor.</h1><p class="subtitle">Sign in to your factory workspace.</p><form id="login-form"><div class="error" id="login-error"></div>${select(
    "Demo account",
    "username",
    [
      ["admin", "Factory admin"],
      ["production", "Production supervisor"],
      ["salesman.a", "Salesman A"],
      ["salesman.b", "Salesman B"],
      ["auditor", "Read-only auditor"],
      ["accountant", "Accountant"],
      ["owner", "Owner"],
    ],
  )}${field("Password", "password", "Demo@12345", "password", 'required autocomplete="current-password"')}<button class="btn">Sign in</button></form><div class="demo-note"><strong>Benchmark-ready demo</strong><br>All seven accounts use <code>Demo@12345</code>.<br>Fresh data starts with the exact opening stock in the brief. The benchmark guide walks you through each transaction.</div></div></section></main>`;
  document.querySelector("#login-form").onsubmit = async (event) => {
    event.preventDefault();
    const b = event.target.querySelector("button");
    b.disabled = true;
    try {
      await api("login", Object.fromEntries(new FormData(event.target)));
      page = "overview";
      dashboardData = null;
      await refresh();
      await sync();
    } catch (err) {
      document.querySelector("#login-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}
const navigation = () => {
  if (can("salesman"))
    return [
      ["overview", "My workspace"],
      ["assistant", "Assistant"],
      ["orders", "My orders"],
    ];
  if (can("production"))
    return [
      ["overview", "Floor overview"],
      ["assistant", "Assistant"],
      ["production", "Production"],
      ["planner", "Production planner"],
      ["inventory", "Inventory"],
      ["purchases", "Purchases"],
      ["benchmark", "Benchmark guide"],
    ];
  return [
    ["overview", "Overview"],
    ["assistant", "Assistant"],
    ["orders", "Sales orders"],
    ["production", "Production"],
    ["planner", "Production planner"],
    ["inventory", "Inventory"],
    ["purchases", "Purchases"],
    ["invoices", "Invoices & payments"],
    ["reports", "Reports"],
    ["masters", "Master data"],
    ["audit", "Audit trail"],
    ["reconciliation", "Reconciliation"],
    ["recall", "Batch recall"],
    ["settings", "Settings"],
    ["benchmark", "Benchmark guide"],
  ];
};
function render() {
  const nav = navigation();
  if (!nav.some((n) => n[0] === page)) page = "overview";
  const title = nav.find((n) => n[0] === page)[1];
  app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="#"><img src="/icon.svg" alt=""><div>My Order</div></a><div class="navlabel">Factory workspace</div><nav class="nav">${nav.map(([id, label]) => `<button data-page="${id}" class="${page === id ? "active" : ""}">${icon(id)}${label}</button>`).join("")}</nav><div class="sidebar-foot"><strong>My Order Demo Foods</strong>Tiruchirappalli, Tamil Nadu<br>FY ${Number(state.today.slice(5, 7)) >= 4 ? state.today.slice(0, 4) : Number(state.today.slice(0, 4)) - 1} · INR</div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace <span class="muted">/</span> <strong>${e(title)}</strong></div><div class="userbar"><div class="avatar">${state.user.name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join(
      "",
    )}</div><div>${e(state.user.name)}<span class="role">${state.user.role === "auditor" ? "Read-only auditor" : e(state.user.role)}</span></div><button class="linkbutton" data-action="logout">Sign out</button></div></header><main class="main">${!navigator.onLine ? '<div class="notice warn">You’re offline. Sales orders will be saved on this device and synced when the network returns.</div>' : ""}${queue().filter((x) => x.user === state.user.id).length ? `<div class="notice warn">${queue().filter((x) => x.user === state.user.id).length} order(s) waiting to sync. ${btn("Sync now", "sync", "", "secondary small")}</div>` : ""}${views[page]()}</main></div></div>`;
  bind();
}
const stats = (cards) =>
  `<div class="stats">${cards.map(([label, value, hint]) => `<div class="stat"><div class="label">${label}</div><div class="value num">${value}</div><div class="hint">${hint}</div></div>`).join("")}</div>`;
function overview() {
  if (can("salesman")) {
    const total = state.orders
      .filter((o) => ["invoiced", "dispatched"].includes(o.status))
      .reduce(
        (a, o) =>
          a +
          o.lines.reduce((b, l) => b + Math.round((l.qty * l.price) / 1000), 0),
        0,
      );
    return (
      heading(
        "Your sales desk",
        "Good work starts here.",
        "Take an order in a few taps. Follow it all the way to dispatch.",
        btn("+ New order", "new-order"),
      ) +
      stats([
        ["My orders", state.orders.length, "All recorded orders"],
        [
          "Awaiting approval",
          state.orders.filter((o) => o.status === "submitted").length,
          "At the factory desk",
        ],
        ["Sales before tax", rs(total), "Invoiced or dispatched"],
        ["My customers", state.customers.length, "Assigned accounts"],
      ]) +
      panel(
        "Customer-wise sales",
        "Invoiced and dispatched orders",
        table(
          ["Customer", "Orders", "Sales before tax"],
          state.customers.map((c) => {
            const os = state.orders.filter((o) => o.customer_id === c.id);
            return [
              e(c.name),
              os.length,
              rs(
                os
                  .filter((o) => ["invoiced", "dispatched"].includes(o.status))
                  .reduce(
                    (a, o) =>
                      a +
                      o.lines.reduce(
                        (b, l) => b + Math.round((l.qty * l.price) / 1000),
                        0,
                      ),
                    0,
                  ),
              ),
            ];
          }),
        ),
      ) +
      orders(false)
    );
  }
  const fg = state.stock.filter((s) => s.kind === "finished"),
    latest = state.runs.at(-1),
    pending = (state.orders || []).filter(
      (o) => o.status === "submitted",
    ).length,
    outstanding = (state.invoices || []).reduce((a, i) => a + i.outstanding, 0);
  return (
    heading(
      "Factory pulse",
      can("production")
        ? "A clear view of the floor."
        : "A good day starts with clarity.",
      `${new Date(state.today + "T12:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · My Order Demo Foods`,
      can("admin")
        ? btn("+ New order", "new-order")
        : can("production")
          ? btn("+ Production run", "new-run")
          : "",
    ) +
    stats([
      [
        "Finished goods",
        q(fg.reduce((a, i) => a + i.qty, 0)),
        "Packets ready in stock",
      ],
      ["Orders to verify", pending, "Waiting for admin approval"],
      [
        "Latest cost / packet",
        latest ? rs(latest.cost_per_packet) : "—",
        "Actual materials + overheads",
      ],
      [
        "Outstanding dues",
        can("production") ? "—" : rs(outstanding),
        can("production")
          ? "Available to the billing desk"
          : "Across all posted invoices",
      ],
    ]) +
    ownerMetrics() +
    batchAlerts() +
    `<div class="grid2">${panel("Production at a glance", "Latest run · planned against actual", latest ? `<div class="panelbody"><div class="actions">${badge(latest.batch, "blue")}${badge(Math.abs(latest.yield_variance) > latest.tolerance / 100 ? "Yield variance flagged" : "Within tolerance", Math.abs(latest.yield_variance) > latest.tolerance / 100 ? "bad" : "good")}</div><div class="yield"><div class="big">${q(latest.actual)} <small>/ ${q(latest.expected)} packets</small></div><strong class="${latest.yield_variance < 0 ? "inline-err" : ""}">${pct(latest.yield_variance)}</strong></div><div class="bar"><span style="width:${Math.min(100, (latest.actual / latest.expected) * 100)}%"></span></div><div class="chart-legend"><span>Actual good output</span><span>Expected yield</span></div><div class="metrics"><div><small>Materials consumed</small><strong>${rs(latest.material)}</strong></div><div><small>Allocated overheads</small><strong>${rs(latest.labour + latest.power + latest.gas + latest.other)}</strong></div><div><small>Run cost</small><strong>${rs(latest.total)}</strong></div></div></div>` : empty("Your first batch starts here", "Record a production run to see yield, material variance, and cost per packet."), `<button class="linkbutton" data-page="production">View production</button>`)}${panel(
      "On the shelf",
      "Live stock from the movement ledger",
      `<div class="panelbody">${state.stock
        .slice(0, 6)
        .map(
          (s) =>
            `<div class="stockrow"><span class="itemicon">${icon("inventory")}</span><div class="info"><strong>${e(s.name)}</strong><small>${e(s.kind)} material${s.kind === "finished" ? " · finished packets" : ""}</small></div><div class="qty num">${q(s.qty)}<small>${e(s.unit)}</small></div></div>`,
        )
        .join("")}</div>`,
    )}</div>` +
    (!can("production")
      ? panel(
          "Recent sales orders",
          "From the field to your factory",
          orderTable(state.orders.slice(0, 5)),
          `<button class="linkbutton" data-page="orders">View all orders</button>`,
        )
      : "") +
    `<div class="notice">${can("admin", "production") ? "New workspace? Open the <strong>Benchmark guide</strong> to run the exact internship scenario." : "Reports reconcile to the stock ledger and source documents. Export a selected date range from Reports."}</div>`
  );
}
function orderTable(os) {
  return table(
    [
      "Order / date",
      "Customer",
      "Quantity",
      "Value before tax",
      "Status",
      "Action",
    ],
    os.map((o) => [
      `<strong>ORD-${String(o.id).padStart(4, "0")}</strong><small>${e(o.date)}</small>`,
      `${e(o.customer)}<small>${e(o.state)} · ${e(o.salesman)}</small>`,
      o.lines.map((l) => `${q(l.qty)} × ${e(l.name)}`).join("<br>"),
      rs(o.lines.reduce((s, l) => s + Math.round((l.qty * l.price) / 1000), 0)),
      badge(o.status) +
        (o.parent_id ? `<small>Backorder of ORD-${o.parent_id}</small>` : ""),
      can("admin") && o.status === "submitted"
        ? btn("Verify", "verify", o.id, "secondary small") +
          btn("Cancel", "cancel-order", o.id, "danger small")
        : can("admin") && o.status === "approved"
          ? btn("Create invoice", "make-invoice", o.id, "small") +
            btn("Cancel", "cancel-order", o.id, "danger small")
          : o.lines.some((l) => l.available < l.qty) && o.status === "submitted"
            ? badge("Stock shortage", "warn")
            : "—",
    ]),
  );
}
function orders(withHeading = true) {
  return (
    (withHeading
      ? heading(
          "Sales loop",
          can("salesman") ? "My orders" : "Sales orders",
          "One order, from field capture to factory dispatch.",
          can("salesman", "admin") ? btn("+ New order", "new-order") : "",
        )
      : "") +
    panel(
      "Order book",
      `${state.orders.length} orders · approval reserves available stock`,
      orderTable(state.orders),
    ) +
    (can("salesman")
      ? panel(
          "Device sync queue",
          "Offline orders reserve no stock. Failed drafts remain available for retry; server validation is authoritative.",
          table(
            ["Client ID", "Status", "Attempts / details", "Review"],
            queue()
              .map((x, index) => ({ ...x, index }))
              .filter((x) => x.user === state.user.id)
              .map((x) => [
                e(x.key),
                badge(x.status || "pending"),
                `${x.attempts || 0} · ${e(x.error || "Waiting for connection")}`,
                btn("Review draft", "queue-review", x.index, "secondary small"),
              ]),
          ),
          btn("Retry queued orders", "sync", "", "secondary small"),
        ) +
        panel(
          "Recently synced",
          "Device history; authoritative orders are above.",
          table(
            ["Client ID", "Status", "Order"],
            JSON.parse(localStorage.getItem("grain-sync-history") || "[]")
              .filter((x) => x.user === state.user.id)
              .map((x) => [
                e(x.key),
                badge("synced", "good"),
                `ORD-${x.order_id || "—"}`,
              ]),
          ),
        )
      : "")
  );
}
function production() {
  return (
    heading(
      "Production loop",
      "Recipes into reality.",
      "Record actual consumption, good output, and the cost of every run.",
      can("production", "admin") ? btn("+ Production run", "new-run") : "",
    ) +
    (state.runs.length
      ? state.runs
          .slice()
          .reverse()
          .map(
            (r) =>
              `<section class="panel"><div class="panelhead"><div><h2>${e(itemName(r.product_id))}</h2><p>RUN-${r.id} · ${e(r.batch)} · ${e(r.date)}</p><p>${(() => {
                const b = state.batches?.find((b) => b.run_id === r.id);
                return b
                  ? `Manufactured ${e(b.manufactured_on)} · Expires ${e(b.expires_on)}`
                  : "Batch dates not recorded for this historical run";
              })()}</p></div>${can("production", "admin") ? btn("Edit overheads", "overhead", r.id, "secondary small") : badge("Posted", "good")}</div><div class="panelbody"><div class="stats">${[
                ["Expected output", q(r.expected) + " packets"],
                ["Good output", q(r.actual) + " packets"],
                ["Yield variance", pct(r.yield_variance)],
                ["Cost per packet", rs(r.cost_per_packet)],
              ]
                .map(
                  ([l, v]) =>
                    `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`,
                )
                .join(
                  "",
                )}</div>${Math.abs(r.yield_variance) > r.tolerance / 100 ? `<div class="notice danger">Yield is ${pct(r.yield_variance)} against the BOM. This exceeds the ${r.tolerance / 100}% tolerance.</div>` : ""}${table(
                ["Material", "Planned", "Actual", "Variance", "Review"],
                r.components.map((c) => [
                  e(itemName(c.item_id)),
                  q(c.planned) +
                    " " +
                    e(state.items.find((i) => i.id === c.item_id).unit),
                  q(c.actual),
                  pct(c.variance),
                  badge(
                    Math.abs(c.variance) > r.tolerance / 100
                      ? "Flagged"
                      : "Within tolerance",
                    Math.abs(c.variance) > r.tolerance / 100 ? "bad" : "good",
                  ),
                ]),
              )}<div class="metrics"><div><small>Damaged pouches</small><strong>${q(r.damaged)}</strong></div><div><small>Material cost</small><strong>${rs(r.material)}</strong></div><div><small>Labour + gas / power</small><strong>${rs(r.labour + r.power)}</strong></div><div><small>Total run cost</small><strong>${rs(r.total)}</strong></div></div><p class="subtitle" style="margin-top:18px">Moving weighted average valuation · overheads allocated to good packets · margin at list price: ${rs((state.items.find((i) => i.id === r.product_id)?.price || 0) - r.cost_per_packet)} / packet.</p></div></section>`,
          )
          .join("")
      : panel(
          "Production runs",
          "Post one batch to connect materials, stock, and costing.",
          empty(
            "No production runs yet",
            "The benchmark starts with 200 expected packets and 188 good packets.",
          ),
        ))
  );
}
function batchAlerts() {
  const lots = (state.batches || []).filter((b) => b.remaining > 0);
  const expired = lots
    .filter((b) => b.status === "Expired")
    .reduce((n, b) => n + b.remaining, 0);
  const soon = lots
    .filter((b) => b.status === "Expiring soon")
    .reduce((n, b) => n + b.remaining, 0);
  const held = lots
    .filter((b) => b.status === "Needs dates")
    .reduce((n, b) => n + b.remaining, 0);
  return `${expired ? `<div class="notice danger"><strong>${q(expired)} expired packets held.</strong> These remain in physical stock and cannot be dispatched.</div>` : ""}${soon ? `<div class="notice warn"><strong>${q(soon)} packets expire within 7 days.</strong> Dispatch uses the earliest expiry first, including stock expiring today.</div>` : ""}${held ? `<div class="notice warn"><strong>${q(held)} packets need batch dates.</strong> Open Inventory → Batches & expiry to register actual batch details before dispatch.</div>` : ""}`;
}
function batchTable() {
  const batches = state.batches || [];
  return (
    panel(
      "Batches & expiry",
      "Finished packets · earliest expiry first · expiry date is the final dispatchable day.",
      table(
        [
          "Product / batch",
          "Manufactured",
          "Expires",
          "Remaining",
          "Status",
          "Action",
        ],
        batches.map((b) => [
          `<strong>${e(b.product)}</strong><small>${e(b.code)}${b.run_id ? ` · RUN-${b.run_id}` : b.legacy ? " · existing stock" : " · opening stock"}</small>`,
          e(b.manufactured_on || "Not recorded"),
          e(b.expires_on || "Not recorded"),
          `${q(b.remaining)} / ${q(b.qty)} packets`,
          badge(
            b.status,
            b.status === "Expired"
              ? "bad"
              : ["Needs dates", "Expiring soon"].includes(b.status)
                ? "warn"
                : b.status === "Ready"
                  ? "good"
                  : "",
          ),
          b.legacy && b.remaining > 0 && can("admin", "production")
            ? btn("Register batch", "batch-register", b.id, "secondary small")
            : "—",
        ]),
      ),
    ) +
    (!can("production")
      ? panel(
          "Dispatch traceability",
          "Find which batch reached each customer. Dispatches made before this feature have no batch allocation history.",
          table(
            [
              "Dispatch date",
              "Batch / product",
              "Customer",
              "Order / invoice",
              "Packets",
              "Expiry",
            ],
            (state.batch_trace || []).map((a) => [
              e(a.date),
              `<strong>${e(a.code)}</strong><small>${e(a.product)}${a.run_id ? ` · RUN-${a.run_id}` : ""}</small>`,
              e(a.customer),
              `ORD-${a.order_id}<small><a href="/api/invoice/${a.invoice_id}.pdf" target="_blank" rel="noopener">${e(a.invoice)}</a></small>`,
              q(a.qty),
              e(a.expires_on),
            ]),
          ),
        )
      : "")
  );
}
function batchRegisterForm(id) {
  const b = state.batches.find((b) => b.id === id);
  showForm(
    "Register existing stock by batch",
    `<div class="notice">${e(b.product)}: ${q(b.remaining)} packets without recorded dates. Enter one real batch at a time from its packaging or production records. This does not create extra stock.</div><div class="formgrid">${field("Actual batch number", "code", "", "text", 'required maxlength="80"')}${num("Packets in this batch", "qty", b.remaining / 1000, "1")}${field("Manufacturing date", "manufactured_on", "", "date", `required max="${state.today}"`)}${field("Expiry date", "expires_on", "", "date", "required")}</div>${field("Verification reference / reason", "reason", "", "text", "required")}`,
    (p) => mutate("batchRegister", { ...p, id }),
    "Register batch",
  );
}
async function dispatchForm(id) {
  const preview = await api(`dispatch/${id}`);
  showForm(
    "Dispatch earliest-expiring batches",
    `<p class="subtitle">Pick these batches before confirming the goods have left the factory. Availability and expiry are checked again when you confirm.</p>${table(
      ["Product", "Batch", "Packets", "Expiry"],
      preview.batches.map((b) => [
        e(b.product),
        e(b.code),
        q(b.qty),
        e(b.expires_on),
      ]),
    )}<div class="notice">Expired and undated batches cannot be dispatched. Another dispatch can change this plan; the server always allocates earliest expiry first.</div>`,
    () =>
      mutate("dispatch", {
        id,
        expected_batches: preview.batches.map((b) => ({
          batch_id: b.batch_id,
          qty: b.qty,
        })),
      }),
    "Confirm dispatch",
  );
}

function inventory() {
  return (
    heading(
      "Inventory",
      "Every movement has a story.",
      "Physical stock includes held batches. Dispatchable quantities exclude expired and undated stock.",
    ) +
    batchAlerts() +
    `<div class="tabs"><button data-stock="batches" class="${stockTab === "batches" ? "active" : ""}">Batches & expiry</button><button data-stock="stock" class="${stockTab === "stock" ? "active" : ""}">Stock summary</button><button data-stock="ledger" class="${stockTab === "ledger" ? "active" : ""}">Movement ledger</button></div>` +
    (stockTab === "batches"
      ? batchTable()
      : stockTab === "stock"
        ? panel(
            "Current balances",
            "Available quantity excludes held stock and quantities reserved by approved or invoiced orders.",
            table(
              [
                "Item",
                "Category",
                "On hand",
                "Reserved",
                "Held",
                "Available",
                "Stock value",
              ],
              state.stock.map((i) => [
                `<strong>${e(i.name)}</strong><small>HSN ${e(i.hsn)}</small>`,
                badge(i.kind),
                q(i.qty) + " " + e(i.unit),
                q(i.reserved),
                q(i.held || 0),
                q(i.available),
                rs(i.value),
              ]),
            ),
          )
        : panel(
            "Stock ledger",
            "Every receipt and issue links to its source document.",
            table(
              ["Date", "Item", "Source", "Movement", "Closing", "Valuation"],
              state.ledger
                .slice()
                .reverse()
                .map((m) => [
                  e(m.date),
                  e(m.item),
                  `${e(m.source)} #${m.source_id}<small>${e(m.note)}</small>`,
                  `<strong>${m.qty > 0 ? "+" : ""}${q(m.qty)} ${e(m.unit)}</strong>`,
                  q(m.balance),
                  rs(m.value),
                ]),
            ),
          ))
  );
}
function purchases() {
  return (
    heading(
      "Materials in",
      "Purchases & receipts",
      "Receive materials once. Stock and weighted average cost update together.",
      can("production", "admin")
        ? btn("+ Receive purchase", "new-purchase")
        : "",
    ) +
    panel(
      "Purchase register",
      "Rates are net of recoverable tax.",
      table(
        ["Receipt", "Supplier", "Item", "Quantity", "Net cost"],
        state.purchases.map((p) => [
          `PUR-${p.id}<small>${e(p.date)} · ${e(p.reference)}</small>`,
          e(p.supplier),
          e(p.item),
          q(p.qty),
          rs(p.amount),
        ]),
      ),
    )
  );
}
function invoices() {
  return (
    heading(
      "Billing desk",
      "Invoices & collections",
      "GST by place of supply. Receivables that stay in step with collections.",
    ) +
    stats([
      [
        "Total invoiced",
        rs(
          state.invoices
            .filter((i) => i.status === "posted")
            .reduce((s, i) => s + i.total, 0),
        ),
        "Including output GST",
      ],
      [
        "Collected",
        rs(state.payments.reduce((s, i) => s + i.amount, 0)),
        "Recorded against invoices",
      ],
      [
        "Outstanding",
        rs(state.invoices.reduce((s, i) => s + i.outstanding, 0)),
        "After payments and credits",
      ],
      [
        "Awaiting dispatch",
        state.invoices.filter((i) => i.status === "posted" && !i.dispatched)
          .length,
        "Stock is reserved",
      ],
    ]) +
    panel(
      "Tax invoices",
      "Invoices are immutable. Credit notes change receivables. Physical returns and refunds are separate transactions.",
      table(
        [
          "Invoice",
          "Customer / supply",
          "Total",
          "Paid / outstanding",
          "Status",
          "Actions",
        ],
        state.invoices.map((i) => [
          `<strong>${e(i.number)}</strong><small>${i.date}</small>`,
          `${e(i.customer)}<small>${i.igst ? "IGST" : "CGST + SGST"} · ${e(i.state)}</small>`,
          rs(i.total),
          `${rs(i.paid)} paid<small>${rs(i.outstanding)} outstanding</small>`,
          badge(
            i.status === "credited"
              ? "credited"
              : i.dispatched
                ? "dispatched"
                : "invoiced",
          ),
          `<div class="actions"><a class="btn secondary small" href="/api/invoice/${i.id}.pdf" target="_blank" rel="noopener">PDF</a>${can("admin") && i.status === "posted" && !i.dispatched ? btn("Dispatch", "dispatch", i.id, "small") : ""}${can("admin", "accountant") && i.status === "posted" ? (i.outstanding ? btn("Payment", "payment", i.id, "secondary small") : "") + btn("Credit note", "financial-credit", i.id, "danger small") : ""}${can("admin") && i.dispatched && !state.returns.some((r) => r.invoice_id === i.id) ? btn("Physical return", "return-goods", i.id, "secondary small") : ""}${can("admin", "accountant") && i.status === "credited" && i.paid > state.refunds.filter((r) => r.invoice_id === i.id).reduce((a, r) => a + r.amount, 0) ? btn("Refund", "refund", i.id, "secondary small") : ""}</div>`,
        ]),
      ),
    ) +
    panel(
      "Collections",
      "Payment references and invoice allocation",
      table(
        ["Date", "Customer", "Invoice", "Reference", "Received"],
        state.payments.map((p) => [
          p.date,
          e(p.customer),
          e(p.number),
          e(p.reference),
          rs(p.amount),
        ]),
      ),
    ) +
    (state.credits.length
      ? panel(
          "Credit notes",
          "Cancelled documents remain in the audit trail.",
          table(
            ["Number", "Date", "Invoice", "Amount", "Reason"],
            state.credits.map((c) => [
              `<a href="/api/credit/${c.id}.pdf" target="_blank" rel="noopener">${e(c.number)}</a>`,
              c.date,
              c.invoice_id,
              rs(c.amount),
              e(c.reason),
            ]),
          ),
        )
      : "")
  );
}
const reportOptions = [
  ["sales", "Sales register"],
  ["customer-sales", "Customer-wise sales"],
  ["product-sales", "Product-wise sales"],
  ["gst", "GST outward supplies"],
  ["purchases", "Purchase register"],
  ["stock", "Stock summary"],
  ["raw-stock", "Raw-material stock"],
  ["packaging-stock", "Packaging stock"],
  ["finished-stock", "Finished-goods stock"],
  ["costing", "Product costing"],
  ["expiry", "Batch expiry"],
  ["reconciliation", "Audit reconciliation"],
  ["refunds", "Refunds"],
  ["ledger", "Stock movement ledger"],
  ["production", "Production variance & cost"],
  ["collections", "Payments & collections"],
  ["outstanding", "Receivables & ageing"],
];
function reports() {
  return (
    heading(
      "Month-end, made clear",
      "Reports ready for review.",
      "Choose a date range. Download Excel-compatible CSV or a paginated PDF.",
    ) +
    `<form id="report-form" class="reportfilters">${select("Report", "type", reportOptions, reportType)}${field("From", "from", from, "date", "required")}${field("To / as of", "to", to, "date", "required")}${select("Customer", "customer_id", [["", "All customers"], ...state.customers.map((c) => [c.id, c.name])], reportFilters.customer_id)}${select("Item / product", "product_id", [["", "All items"], ...state.items.map((i) => [i.id, i.name])], reportFilters.product_id)}${select("Batch", "batch_id", [["", "All batches"], ...state.batches.map((b) => [b.id, b.code])], reportFilters.batch_id)}<button class="btn">View report</button></form><div class="notice">GST exports provide outward-supply data for reconciliation to GSTR-1 and GSTR-3B. They are not filing JSON. Receivables show payments and credit notes up to the selected end date.</div>` +
    panel(
      reportOptions.find((r) => r[0] === reportType)[1],
      `${from} to ${to}`,
      report
        ? table(
            Object.keys(report.rows[0] || {}).map(e),
            report.rows.map((r) => Object.values(r).map(e)),
          )
        : empty(
            "Select a report to begin",
            "Use View report to preview the rows before exporting.",
          ),
      `<div class="actions"><a class="btn secondary small" href="${reportURL("csv")}">Export CSV</a><a class="btn secondary small" href="${reportURL("pdf")}">Export PDF</a></div>`,
    )
  );
}
function reportURL(format) {
  return `/api/report?${new URLSearchParams({ type: reportType, from, to, format, ...reportFilters })}`;
}
function masters() {
  return (
    heading(
      "The foundations",
      "Master data & recipes",
      "Products, materials, customers, suppliers, and versioned BOM recipes.",
      can("admin") ? btn("+ Add master", "new-master") : "",
    ) +
    panel(
      "Products & materials",
      "Base units prevent incompatible conversions.",
      table(
        ["Item", "Category", "Base unit", "Price / packet", "GST", "HSN"],
        state.items.map((i) => [
          e(i.name),
          badge(i.kind),
          e(i.unit),
          i.kind === "finished" ? rs(i.price) : "—",
          i.kind === "finished" ? `${i.gst / 100}%` : "—",
          e(i.hsn),
        ]),
      ),
    ) +
    panel(
      "Bill of materials",
      "New recipes are separate versions. Posted runs preserve their recipe snapshot.",
      table(
        ["Recipe", "Product", "Expected output", "Components"],
        state.boms.map((b) => [
          e(b.name),
          e(itemName(b.product_id)),
          q(b.yield_qty) + " packets",
          b.components
            .map(
              (c) =>
                `${e(itemName(c.item_id))}: ${q(c.qty)} ${e(state.items.find((i) => i.id === c.item_id).unit)}`,
            )
            .join("<br>"),
        ]),
      ),
      can("admin") ? btn("+ New recipe", "new-bom", "", "secondary small") : "",
    ) +
    panel(
      "Customers",
      "Salesmen can only access their assigned customers.",
      table(
        ["Customer", "State", "GSTIN", "Salesman"],
        state.customers.map((c) => [
          e(c.name),
          e(c.state),
          e(c.gstin),
          e(state.salesmen.find((s) => s.id === c.salesman_id)?.name),
        ]),
      ),
    ) +
    panel(
      "Suppliers",
      "Purchase sources",
      table(
        ["Supplier", "GSTIN"],
        state.suppliers.map((s) => [e(s.name), e(s.gstin)]),
      ),
    )
  );
}
function audit() {
  return (
    heading(
      "Traceability",
      "The record behind the numbers.",
      "The latest 200 changes, with who, when, and the source document.",
    ) +
    panel(
      "Audit trail",
      "Invoice posting, dispatch, overhead amendments, and master changes are retained.",
      table(
        ["When", "Who", "Action", "Document", "Details"],
        state.audit.map((a) => [
          new Date(a.time).toLocaleString("en-IN"),
          e(a.user),
          e(a.action),
          `${e(a.entity)} #${a.entity_id}`,
          `<details><summary>View change</summary><pre>${e(JSON.stringify(JSON.parse(a.details), null, 2))}</pre></details>`,
        ]),
      ),
    )
  );
}
function benchmark() {
  const stock = Object.fromEntries(state.stock.map((i) => [i.id, i.qty])),
    r = state.runs.at(-1),
    i = state.invoices?.find((i) => i.customer_id === 1);
  const checks = [
    ["Flour closing", stock[1] === 120000, "120 kg"],
    ["Oil closing", stock[2] === 19500, "19.5 L"],
    ["Pouches closing", stock[4] === 306000, "306 pieces"],
    ["Finished after dispatch", stock[6] === 88000, "88 packets"],
    ["Yield variance", r?.yield_variance === -6, "−6%"],
    [
      "Oil variance",
      r?.components.find((c) => c.item_id === 2)?.variance === 5,
      "+5%",
    ],
    ["Retailer invoice", i?.total === 787500, "₹7,875"],
    ["Retailer outstanding", i?.outstanding === 387500, "₹3,875"],
    ["Cost / good packet", r?.cost_per_packet === 3114, "₹31.14"],
  ];
  return (
    heading(
      "The mandatory scenario",
      "From opening stock to audit.",
      "Run these steps in order. Fresh installations include only masters and opening stock.",
    ) +
    `<div class="notice">Use the account menu to sign out and switch roles. Demo password: <strong>Demo@12345</strong>. Each transaction is entered through its normal form. This guide does not silently populate results.</div><div class="steps">${[
      [
        "Receive flour",
        "Production or admin: receive 60 kg flour at ₹45/kg.",
        "new-purchase",
      ],
      [
        "Post a production run",
        "Production: issue 40 kg flour, 10.5 L oil, 1.2 kg spice, 194 pouches, and 9 cartons. Record 188 good packets and 6 damaged pouches.",
        "new-run",
      ],
      [
        "Take Retailer A’s order",
        "Salesman A: submit 150 packets for Retailer A in Tamil Nadu.",
        "",
      ],
      [
        "Verify, invoice, dispatch",
        "Admin: approve the order, generate the invoice, then dispatch 150 packets.",
        "",
      ],
      [
        "Show the stock shortage",
        "Salesman B: order 120 packets for Distributor B. Admin approval should report a 32-packet shortage.",
        "",
      ],
      [
        "Collect and cost",
        "Admin: record ₹4,000 payment. Production: add ₹1,200 labour and ₹600 gas/power to the posted run.",
        "",
      ],
      [
        "Export monthly reports",
        "Admin or auditor: export sales, GST, purchases, stock, production, collections, and outstanding.",
        "",
      ],
    ]
      .map(
        ([title, desc, action], ix) =>
          `<div class="step"><span>Step ${ix + 1}</span><h3>${title}</h3><p>${desc}</p>${action && can("admin", "production") ? btn("Open form", action, "", "secondary small") : ""}</div>`,
      )
      .join(
        "",
      )}</div><div class="heading" style="margin-top:30px"><h2>Benchmark checkpoints</h2></div><div class="benchmark-checks">${checks.map(([l, ok, target]) => `<div class="check"><span>${l}</span><b class="${ok ? "" : "pending"}">${ok ? "✓ " : ""}${target}</b></div>`).join("")}</div>`
  );
}
function plannerView() {
  return (
    heading(
      "Production intelligence",
      "Smart Production Planner",
      "Pending demand minus available stock and approved schedules. Overheads are estimated from the latest recorded run when available.",
    ) +
    (state.planner || [])
      .map((p) =>
        panel(
          e(p.product),
          `${e(p.bom_name || "Create a BOM")} · ${e(p.priority)} priority`,
          stats([
            ["Pending demand", q(p.pending_demand), "Unreserved orders"],
            ["Available", q(p.available), `${q(p.reserved)} reserved`],
            ["Scheduled", q(p.scheduled), "Approved output"],
            ["Shortage", q(p.shortage), `${p.batches} recommended batches`],
            ["Expected output", q(p.expected), "Before actual variance"],
            [
              "Materials estimate",
              p.estimated_material_cost === null
                ? "Unknown rate"
                : rs(p.estimated_material_cost),
              "Overheads excluded",
            ],
            [
              "Estimated overheads",
              p.estimated_overheads === null
                ? "No run history"
                : rs(p.estimated_overheads),
              p.overhead_basis_run
                ? `Scaled from RUN-${p.overhead_basis_run}`
                : "Record an actual run first",
            ],
            [
              "Estimated run cost",
              p.estimated_production_cost === null
                ? "Incomplete estimate"
                : rs(p.estimated_production_cost),
              "Materials plus historical overhead estimate",
            ],
          ]) +
            table(
              [
                "Material",
                "Required",
                "Free after schedules",
                "Purchase",
                "Estimated cost",
              ],
              p.materials.map((m) => [
                e(m.name),
                `${q(m.required)} ${e(m.unit)}`,
                q(m.available),
                q(m.purchase_qty),
                m.estimated_cost === null ? "Unknown" : rs(m.estimated_cost),
              ]),
            ),
          can("admin") && p.batches
            ? btn("Approve schedule", "plan-approve", p.product_id)
            : "",
        ),
      )
      .join("") +
    panel(
      "Production schedule",
      "BOM versions are retained. Posting rechecks material availability.",
      table(
        [
          "Plan",
          "Product / BOM",
          "Date",
          "Batches / output",
          "Status",
          "Action",
        ],
        (state.plans || []).map((p) => [
          `PLAN-${p.id}`,
          `${e(p.product)}<small>${e(p.bom)}</small>`,
          e(p.scheduled_on),
          `${q(p.batches)} / ${q(p.expected)}`,
          badge(p.status),
          p.status === "scheduled"
            ? (can("admin", "production")
                ? btn("Record production", "plan-run", p.id, "secondary small")
                : "") +
              (can("admin")
                ? btn("Cancel", "plan-cancel", p.id, "danger small")
                : "")
            : p.run_id
              ? `RUN-${p.run_id}`
              : "—",
        ]),
      ),
    ) +
    panel(
      "Inventory alerts",
      "Reorder levels and expiry holds",
      table(
        ["Alert", "Item", "Details"],
        (state.alerts || []).map((a) => [
          badge(a.kind, "warn"),
          e(a.item),
          e(a.detail),
        ]),
      ),
    )
  );
}
function reconciliationView() {
  const r = state.reconciliation;
  return (
    heading(
      "Independent checks",
      "Audit Reconciliation",
      "Compare sources, movements, batches and invoice allocations. Reports support earlier cutoff dates.",
    ) +
    stats([
      ["Status", e(r?.status || "Unavailable"), "No silent balance repair"],
      ["Exceptions", r?.issues.length || 0, "Investigate source documents"],
      [
        "Receipt value difference",
        rs(r?.value_difference || 0),
        "Paisa comparison",
      ],
    ]) +
    panel(
      "Stock control",
      "Expected quantities come from source documents.",
      table(
        ["Item", "Expected", "Recorded", "Difference", "Value"],
        (r?.rows || []).map((i) => [
          e(i.item),
          q(i.expected),
          q(i.recorded),
          q(i.difference),
          rs(i.value),
        ]),
      ),
    ) +
    panel(
      "Exceptions",
      "This operational reconciliation is not a statutory audit.",
      table(
        ["Check", "Reference", "Details"],
        (r?.issues || []).map((i) => [e(i.type), e(i.reference), e(i.detail)]),
      ),
    ) +
    panel(
      "Traceable adjustments",
      "No posted movement is overwritten.",
      table(
        ["Document", "Date", "Item", "Quantity", "Reason", "Action"],
        (state.adjustments || []).map((a) => [
          `ADJ-${a.id}`,
          e(a.date),
          e(itemName(a.item_id)),
          q(a.qty),
          e(a.reason),
          can("admin") &&
          !a.reverses_id &&
          !state.adjustments.some((x) => x.reverses_id === a.id)
            ? btn("Reverse", "adjust-reverse", a.id, "secondary small")
            : "—",
        ]),
      ),
      can("admin") ? btn("Record adjustment", "adjust-new") : "",
    )
  );
}
function settingsView() {
  return (
    heading(
      "Factory controls",
      "Settings",
      "Split approval creates a linked submitted backorder.",
      can("admin") ? btn("Edit controls", "settings-edit") : "",
    ) +
    stats([
      ["Fulfillment", e(state.settings.fulfillment), "Applied at approval"],
      [
        "Variance tolerance",
        `${Number(state.settings.variance_tolerance) / 100}%`,
        "Stored on each new run",
      ],
    ]) +
    panel(
      "Reorder levels",
      "Zero disables the alert.",
      table(
        ["Item", "Unit", "Level", "Action"],
        state.items.map((i) => [
          e(i.name),
          e(i.unit),
          q(i.reorder_level),
          can("admin")
            ? btn("Set level", "reorder-edit", i.id, "secondary small")
            : "—",
        ]),
      ),
    )
  );
}
function recallView() {
  return (
    heading(
      "Food safety",
      "Batch recall traceability",
      "Recorded dispatches identify affected customers. Historical supplier material lots are not available.",
    ) +
    state.batches
      .map((b) => {
        const run = state.runs.find((r) => r.id === b.run_id),
          trace = state.batch_trace.filter((a) => a.batch_id === b.id);
        return panel(
          e(b.code),
          `${e(b.product)} · ${e(b.status)} · ${q(b.remaining)} packets remain`,
          (run
            ? `<div class="notice">RUN-${run.id} · BOM-${run.bom_id}<br>Consumed: ${run.components.map((c) => `${e(itemName(c.item_id))}: ${q(c.actual)}`).join("; ")}. Supplier lot linkage was not recorded.</div>`
            : '<div class="notice">Opening, verified or returned stock; no production provenance recorded.</div>') +
            table(
              ["Invoice", "Customer", "Order", "Dispatch date", "Packets"],
              trace.map((a) => [
                e(a.invoice),
                e(a.customer),
                `ORD-${a.order_id}`,
                e(a.date),
                q(a.qty),
              ]),
            ),
        );
      })
      .join("")
  );
}
let dashboardData = null,
  reportFilters = {};
function ownerMetrics() {
  if (can("production", "salesman")) return "";
  const d = dashboardData;
  return panel(
    "Performance by date",
    "Revenue excludes GST. Gross profit uses dispatched revenue and operational cost, with dated credits and returns.",
    `<form id="dashboard-form" class="reportfilters">${field("From", "from", from, "date", "required")}${field("To", "to", to, "date", "required")}<button class="btn">Refresh metrics</button></form>` +
      (d
        ? stats([
            ["Revenue", rs(d.revenue), "Invoiced less credits"],
            ["Collections", rs(d.collections), `${rs(d.refunds)} refunded`],
            [
              "Gross profit",
              rs(d.gross_profit),
              `${rs(d.cogs)} net goods cost`,
            ],
            ["Outstanding", rs(d.outstanding), `${rs(d.overdue)} overdue`],
            [
              "Good output",
              q(d.production_output),
              `${d.efficiency.toFixed(1)}% yield`,
            ],
            ["Damaged pouches", q(d.damaged_pouches), "Included in costs"],
            ["Today sales", rs(d.daily_sales), "Net taxable today"],
          ]) +
          table(
            ["Run", "Raw material", "Excess over standard"],
            d.raw_material_excess.map((c) => [
              `RUN-${c.run_id}`,
              e(itemName(c.item_id)),
              q(c.qty),
            ]),
          )
        : '<div class="notice">Refresh to calculate metrics for these dates.</div>') +
      `<div class="actions"><button class="btn secondary" data-page="planner">Production recommendations</button><button class="btn secondary" data-page="reconciliation">${e(state.reconciliation?.status || "Reconciliation")}</button><button class="btn secondary" data-page="reports">Supporting reports</button></div>`,
  );
}
function upgradeAction(action, id) {
  if (action === "queue-review") {
    const entry = queue()[id];
    if (!entry || entry.user !== state.user.id) return;
    return showForm(
      "Review saved draft",
      '<div class="notice">' +
        e(entry.error || "Pending synchronization") +
        ". Check the order book before discarding a draft after a lost connection.</div>" +
        select(
          "Action",
          "resolution",
          entry.error?.startsWith("Product price changed")
            ? [
                ["reprice", "Accept current listed prices and retry"],
                ["discard", "Discard this device draft"],
              ]
            : [["discard", "Discard this device draft"]],
        ),
      async (p) => {
        let entries = queue();
        if (p.resolution === "reprice") {
          entry.body.lines = entry.body.lines.map((l) => ({
            ...l,
            expected_price: state.items.find((i) => i.id === Number(l.item_id))
              .price,
          }));
          entry.key = crypto.randomUUID();
          entry.status = "pending";
          entry.error = "";
          entries[id] = entry;
        } else entries = entries.filter((_, index) => index !== id);
        localStorage.setItem("grain-queue", JSON.stringify(entries));
        await sync();
        render();
      },
      "Confirm reviewed action",
    );
  }
  if (action === "plan-approve") {
    const p = state.planner.find((x) => x.product_id === id);
    return showForm(
      "Approve production schedule",
      `<div class="notice">${p.batches} batches; ${q(p.expected)} expected packets. Material shortages must be purchased before posting.</div>` +
        field(
          "Scheduled date",
          "scheduled_on",
          state.today,
          "date",
          "required",
        ) +
        field("Notes", "notes"),
      (v) =>
        mutate("approvePlan", {
          ...v,
          product_id: id,
          bom_id: p.bom_id,
          batches: p.batches,
        }),
    );
  }
  if (action === "plan-run")
    return runForm(state.plans.find((p) => p.id === id));
  if (["plan-cancel", "cancel-order", "adjust-reverse"].includes(action))
    return showForm(
      "Confirm cancellation / reversal",
      field("Reason", "reason", "", "text", "required"),
      (p) =>
        mutate(
          {
            "plan-cancel": "cancelPlan",
            "cancel-order": "cancelOrder",
            "adjust-reverse": "adjustment",
          }[action],
          {
            ...p,
            ...(action === "adjust-reverse" ? { reverses_id: id } : { id }),
          },
        ),
    );
  if (action === "settings-edit")
    return showForm(
      "Factory controls",
      select(
        "Fulfillment",
        "fulfillment",
        [
          ["strict", "All or nothing"],
          ["split", "Allow split approval"],
        ],
        state.settings.fulfillment,
      ) +
        num(
          "Variance tolerance (%)",
          "variance_tolerance",
          Number(state.settings.variance_tolerance) / 100,
          "0.01",
        ),
      (p) => mutate("configure", p),
    );
  if (action === "reorder-edit") {
    const i = state.items.find((x) => x.id === id);
    return showForm(
      "Reorder: " + e(i.name),
      num(`Level (${e(i.unit)})`, "reorder_level", i.reorder_level / 1000) +
        num("GST for future invoices (%)", "gst", i.gst / 100, "0.01") +
        (i.kind === "finished"
          ? num("Future list price (INR)", "price", i.price / 100, "0.01")
          : ""),
      (p) => mutate("configure", { ...p, item_id: id }),
    );
  }
  if (action === "financial-credit" || action === "return-goods")
    return showForm(
      action === "financial-credit"
        ? "Credit full invoice"
        : "Record full physical return",
      `<div class="notice">${action === "financial-credit" ? "This reverses the full invoice financially. Stock does not change. Collected money becomes refundable." : "Confirm all dispatched goods physically returned. Returned food enters quarantine until inspection and dates are recorded."}</div>` +
        field(
          "Reason / inspection reference",
          "reason",
          "",
          "text",
          "required",
        ),
      (p) =>
        mutate(
          action === "financial-credit" ? "financialCredit" : "returnGoods",
          { ...p, id },
        ),
    );
  if (action === "refund")
    return showForm(
      "Refund a credited collection",
      num("Amount (INR)", "amount", 0, "0.01") +
        field("Unique bank reference", "reference", "", "text", "required"),
      (p) => mutate("refund", { ...p, id }),
    );
  if (action === "adjust-new")
    return showForm(
      "Record stock adjustment",
      select(
        "Item",
        "item_id",
        state.items.map((i) => [i.id, i.name]),
      ) +
        select("Movement", "kind", [
          ["wastage", "Wastage"],
          ["issue", "Issue"],
          ["receipt", "Receipt"],
        ]) +
        num("Quantity in base unit", "qty", 1) +
        num("Receipt rate (INR)", "rate", 0, "0.01") +
        select("Finished goods batch", "batch_id", [
          ["", "Not applicable"],
          ...state.batches.map((b) => [b.id, `${b.product} / ${b.code}`]),
        ]) +
        field("Reason / source reference", "reason", "", "text", "required"),
      (p) => mutate("adjustment", p),
      "Post adjustment",
    );
}
const views = {
  planner: plannerView,
  reconciliation: reconciliationView,
  settings: settingsView,
  recall: recallView,
  assistant: () => factoryAssistant.view(state.user.role),
  overview,
  orders,
  production,
  inventory,
  purchases,
  invoices,
  reports,
  masters,
  audit,
  benchmark,
};
function showForm(title, body, submit, label = "Save transaction") {
  modal.dataset.requestKey = crypto.randomUUID();
  modal.innerHTML = `<div class="modalhead"><h2>${title}</h2><button data-close aria-label="Close dialog">×</button></div><div class="modalbody"><form id="modal-form"><div class="error" id="form-error"></div>${body}<div class="formfoot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">${label}</button></div></form></div>`;
  modal.showModal();
  modal
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => modal.close()));
  modal.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await submit(
        Object.fromEntries(new FormData(event.target)),
        event.target,
      );
      modal.close();
    } catch (err) {
      modal.querySelector("#form-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function mutate(action, p) {
  await api(
    "action/" + action,
    p,
    modal.dataset.requestKey || crypto.randomUUID(),
  );
  await refresh();
  toast("Saved. Stock, reports, and audit trail are up to date.");
}
function productLine(l = {}, verify = false) {
  const products = state.items.filter(
    (i) => i.kind === "finished" || can("salesman"),
  );
  return `<div class="line-entry">${select(
    "Product",
    "item",
    products.map((i) => [i.id, i.name]),
    l.item_id || products[0]?.id,
  )}${num("Quantity", "qty", l.qty ? l.qty / 1000 : 150, "1")}${
    verify
      ? num(
          "Price / packet (₹)",
          "price",
          l.price ? l.price / 100 : 50,
          "0.01",
        ) + num("Discount (%)", "discount", (l.discount || 0) / 100, "0.01")
      : select("Unit", "unit", [
          ["packet", "Packets"],
          ["carton", "Cartons"],
        ])
  }<button type="button" class="linkbutton remove-line">Remove</button></div>`;
}
function bindLines() {
  modal.querySelectorAll(".remove-line").forEach(
    (b) =>
      (b.onclick = () => {
        if (modal.querySelectorAll(".line-entry").length > 1)
          b.closest(".line-entry").remove();
      }),
  );
}
function orderForm(order) {
  let key = crypto.randomUUID();
  showForm(
    order ? "Verify order #" + order.id : "New sales order",
    `${
      order
        ? `<div class="notice">${e(order.customer)} · ${order.lines.map((l) => `${e(l.name)}: ${q(l.available)} packets available`).join(", ")}</div>`
        : select(
            "Customer",
            "customer_id",
            state.customers.map((c) => [c.id, `${c.name} · ${c.state}`]),
          )
    }<div id="order-lines" style="margin-top:20px">${(order ? order.lines : [{}]).map((l) => productLine(l, !!order)).join("")}</div><button type="button" class="btn secondary small" id="add-line">+ Add product</button>${field("Notes", "notes", order?.notes || "")}${order ? `<label style="margin-top:16px"><input type="checkbox" name="reject"> Reject this order instead</label>${field("Reason if rejected", "reason")}<label><input type="checkbox" name="partial"> Approve available quantity and create backorder (requires split setting)</label>` : ""}`,
    async (p, form) => {
      const lines = [...form.querySelectorAll(".line-entry")].map((row) =>
        Object.fromEntries(
          [...row.querySelectorAll("input,select")].map((n) => [
            n.name === "item" ? "item_id" : n.name,
            n.value,
          ]),
        ),
      );
      if (order)
        return mutate("approve", {
          id: order.id,
          lines,
          reject: !!p.reject,
          partial: !!p.partial,
          reason: p.reason,
        });
      if (can("salesman"))
        for (const line of lines)
          line.expected_price = state.items.find(
            (i) => i.id === Number(line.item_id),
          ).price;
      const body = { customer_id: p.customer_id, notes: p.notes, lines };
      try {
        await api("action/order", body, key);
        await refresh();
        toast("Order submitted to the factory.");
      } catch (err) {
        if (err.status) throw err;
        if (!can("salesman"))
          throw Error("Connection lost. Please retry when online.");
        const all = queue();
        if (!all.some((x) => x.key === key)) {
          all.push({
            user: state.user.id,
            key,
            body,
            status: "pending",
            attempts: 0,
          });
          localStorage.setItem("grain-queue", JSON.stringify(all));
        }
        render();
        toast("Order saved on this device. It will sync when online.");
      }
    },
    order ? "Save verification" : "Submit order",
  );
  modal.querySelector("#add-line").onclick = () => {
    modal
      .querySelector("#order-lines")
      .insertAdjacentHTML("beforeend", productLine({}, !!order));
    bindLines();
  };
  bindLines();
}
function purchaseForm() {
  showForm(
    "Receive a material purchase",
    `<div class="formgrid">${select(
      "Supplier",
      "supplier_id",
      state.suppliers.map((s) => [s.id, s.name]),
    )}${field("Supplier document reference", "reference", "PUR-DEMO-001", "text", "required")}${select(
      "Material",
      "item_id",
      state.items
        .filter((i) => i.kind !== "finished")
        .map((i) => [i.id, `${i.name} (${i.unit})`]),
    )}${num("Quantity in base unit", "qty", 60)}${num("Net rate / base unit (₹)", "rate", 45, "0.01")}</div><div class="notice" style="margin-top:20px">Rate excludes recoverable input GST. Posting creates a receipt and updates moving weighted average valuation.</div>`,
    (p) => mutate("purchase", p),
    "Post receipt",
  );
}
function runFields(bom) {
  return `<div class="formgrid">${field("Batch number", "batch", `MK-${state.today.replaceAll("-", "")}-${String(state.runs.length + 1).padStart(3, "0")}`, "text", "required")}${field("Manufacturing date", "manufactured_on", state.today, "date", `required max="${state.today}"`)}${field("Expiry date", "expires_on", "", "date", `required min="${state.today}"`)}${num("Batches planned", "batches", 1)}${num("Good packets produced", "actual", bom.product_id === 6 ? 188 : bom.yield_qty / 1000, "1")}${num("Damaged pouches (included below)", "damaged", bom.product_id === 6 ? 6 : 0, "1")}</div><h3 style="margin-top:24px">Actual material consumption</h3><p class="subtitle">Enter total issued, including packaging damaged or scrapped.</p><div class="formgrid" style="margin-top:16px">${bom.components
    .map((c) => {
      const i = state.items.find((i) => i.id === c.item_id),
        d = { 1: 40, 2: 10.5, 3: 1.2, 4: 194, 5: 9 };
      return num(
        `${e(i.name)} (${e(i.unit)}) · standard ${q(c.qty)}`,
        `component_${c.item_id}`,
        bom.id === 1 ? d[c.item_id] : c.qty / 1000,
      );
    })
    .join(
      "",
    )}</div><h3 style="margin-top:24px">Run overheads</h3><div class="formgrid">${num("Labour (₹)", "labour", 0, "0.01")}${num("Electricity / combined utilities (₹)", "power", 0, "0.01")}</div>${num("Gas (₹)", "gas", 0, "0.01")}${num("Other overheads (₹)", "other", 0, "0.01")}${field("Failure reason (required for zero output)", "failure_reason")}${field("Run notes", "notes", "")}`;
}
function runForm(plan) {
  if (!state.boms.length) return toast("Create a BOM recipe first.");
  let bom = state.boms.find((b) => b.id === plan?.bom_id) || state.boms[0];
  showForm(
    "Post a production run",
    select(
      "BOM recipe",
      "bom_id",
      state.boms.map((b) => [b.id, b.name]),
      bom.id,
    ) + `<div id="run-fields" style="margin-top:20px">${runFields(bom)}</div>`,
    (p) =>
      mutate("production", {
        ...p,
        ...(plan ? { plan_id: plan.id, bom_id: plan.bom_id } : {}),
        components: bom.components.map((c) => ({
          item_id: c.item_id,
          qty: p["component_" + c.item_id],
        })),
      }),
    "Post production",
  );
  if (plan) {
    modal.querySelector("[name=bom_id]").disabled = true;
    modal.querySelector("[name=batches]").value = plan.batches / 1000;
    modal.querySelector("[name=actual]").value = plan.expected / 1000;
    modal.querySelector("[name=damaged]").value = 0;
    for (const c of bom.components)
      modal.querySelector("[name=component_" + c.item_id + "]").value =
        (c.qty * plan.batches) / 1000000;
  }
  modal.querySelector("[name=bom_id]").onchange = (event) => {
    bom = state.boms.find((b) => b.id === Number(event.target.value));
    modal.querySelector("#run-fields").innerHTML = runFields(bom);
  };
}
function overheadForm(id) {
  const r = state.runs.find((r) => r.id === id);
  showForm(
    "Allocate run overheads",
    `<div class="notice">RUN-${id} · ${e(r.batch)} · ${q(r.actual)} good packets. This amendment is logged. Material quantities stay fixed.</div><div class="formgrid">${num("Labour (₹)", "labour", r.labour / 100, "0.01")}${num("Electricity / combined utilities (₹)", "power", r.power / 100, "0.01")}</div>${num("Gas (₹)", "gas", r.gas / 100, "0.01")}${num("Other overheads (₹)", "other", r.other / 100, "0.01")}${field("Amendment reason", "reason", "Final labour and utility allocation", "text", "required")}`,
    (p) => mutate("overhead", { ...p, id }),
    "Save overheads",
  );
}
function paymentForm(id) {
  const i = state.invoices.find((i) => i.id === id);
  showForm(
    "Record a collection",
    `<div class="notice">${e(i.number)} · ${e(i.customer)}<br>Outstanding: <strong>${rs(i.outstanding)}</strong></div>${num("Amount received (₹)", "amount", Math.min(4000, i.outstanding / 100), "0.01")}${field("Bank / cash reference", "reference", "BANK-DEMO-001", "text", "required")}`,
    (p) => mutate("payment", { ...p, invoice_id: id }),
    "Record payment",
  );
}
function confirmForm(title, message, action, id) {
  showForm(
    title,
    `<div class="notice">${message}</div>`,
    () => mutate(action, { id }),
    title,
  );
}
function masterFields(type) {
  if (type === "item")
    return `<div class="formgrid">${field("Item name", "name", "", "text", "required")}${select(
      "Category",
      "kind",
      [
        ["raw", "Raw material"],
        ["packaging", "Packaging"],
        ["finished", "Finished product"],
      ],
    )}${select("Base unit", "unit", [
      ["kg", "kg"],
      ["litre", "litre"],
      ["piece", "piece"],
      ["packet", "packet"],
    ])}${field("HSN", "hsn", "", "text", "required")}${num("Selling price / packet (₹)", "price", 0, "0.01")}${num("GST rate (%)", "gst", 5, "0.01")}${num("Packets per carton", "carton_size", 20, "1")}</div>`;
  if (type === "customer")
    return `<div class="formgrid">${field("Customer name", "name", "", "text", "required")}${select(
      "State / place of supply",
      "state",
      [
        ["Tamil Nadu", "Tamil Nadu"],
        ["Karnataka", "Karnataka"],
        ["Kerala", "Kerala"],
        ["Andhra Pradesh", "Andhra Pradesh"],
        ["Telangana", "Telangana"],
        ["Maharashtra", "Maharashtra"],
      ],
    )}${field("GSTIN (optional)", "gstin")}${select(
      "Assigned salesman",
      "salesman_id",
      state.salesmen.map((s) => [s.id, s.name]),
    )}<div class="full">${field("Address", "address", "", "text", "required")}</div></div>`;
  return (
    field("Supplier name", "name", "", "text", "required") +
    field("GSTIN (optional)", "gstin")
  );
}
function masterForm() {
  showForm(
    "Add master data",
    select("Record type", "type", [
      ["item", "Product or material"],
      ["customer", "Customer"],
      ["supplier", "Supplier"],
    ]) +
      `<div id="master-fields" style="margin-top:20px">${masterFields("item")}</div>`,
    (p) => mutate("master", p),
    "Create record",
  );
  modal.querySelector("[name=type]").onchange = (event) =>
    (modal.querySelector("#master-fields").innerHTML = masterFields(
      event.target.value,
    ));
}
function bomForm() {
  showForm(
    "Create a recipe version",
    `<div class="formgrid">${field("Recipe name / version", "name", "", "text", "required")}${select(
      "Finished product",
      "product_id",
      state.items
        .filter((i) => i.kind === "finished")
        .map((i) => [i.id, i.name]),
    )}${num("Expected good packets / batch", "yield", 200, "1")}</div><h3 style="margin-top:22px">Standard materials per batch</h3><p class="subtitle">Leave unused materials at zero. Create a new version to change an existing recipe.</p><div class="formgrid" style="margin-top:15px">${state.items
      .filter((i) => i.kind !== "finished")
      .map((i) => num(`${e(i.name)} (${e(i.unit)})`, "c_" + i.id, 0))
      .join("")}</div>`,
    (p) =>
      mutate("master", {
        type: "bom",
        name: p.name,
        product_id: p.product_id,
        yield: p.yield,
        components: state.items
          .filter((i) => i.kind !== "finished" && Number(p["c_" + i.id]) > 0)
          .map((i) => ({ item_id: i.id, qty: p["c_" + i.id] })),
      }),
    "Create recipe",
  );
}
let syncInProgress = false;
async function sync() {
  if (!state || !navigator.onLine || syncInProgress) return;
  const userId = state.user.id;
  syncInProgress = true;
  try {
    for (const entry of queue().filter((x) => x.user === userId)) {
      if (state?.user.id !== userId || !navigator.onLine) break;
      try {
        localStorage.setItem(
          "grain-queue",
          JSON.stringify(
            queue().map((x) =>
              x.user === userId && x.key === entry.key
                ? { ...x, status: "retrying", attempts: (x.attempts || 0) + 1 }
                : x,
            ),
          ),
        );
        const posted = await api("action/order", entry.body, entry.key);
        const history = JSON.parse(
          localStorage.getItem("grain-sync-history") || "[]",
        );
        history.push({
          user: userId,
          key: entry.key,
          status: "synced",
          order_id: posted?.id,
        });
        localStorage.setItem(
          "grain-sync-history",
          JSON.stringify(history.slice(-100)),
        );
        // Read the latest queue: another form or tab may have added an order
        // while this network request was in flight.
        const remaining = queue().filter(
          (x) => !(x.user === userId && x.key === entry.key),
        );
        localStorage.setItem("grain-queue", JSON.stringify(remaining));
      } catch (err) {
        localStorage.setItem(
          "grain-queue",
          JSON.stringify(
            queue().map((x) =>
              x.user === userId && x.key === entry.key
                ? { ...x, status: "failed", error: err.message }
                : x,
            ),
          ),
        );
        if (state?.user.id === userId)
          toast("Order sync paused: " + err.message);
        break;
      }
    }
    if (state?.user.id === userId) await refresh();
  } finally {
    syncInProgress = false;
  }
}
function bind() {
  const dashboardForm = document.querySelector("#dashboard-form");
  if (dashboardForm)
    dashboardForm.onsubmit = async (ev) => {
      ev.preventDefault();
      const p = Object.fromEntries(new FormData(dashboardForm));
      try {
        dashboardData = await api("dashboard?" + new URLSearchParams(p));
        from = p.from;
        to = p.to;
        render();
      } catch (err) {
        toast(err.message);
      }
    };
  if (page === "assistant") factoryAssistant.bind(state.user.role);
  app.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        render();
      }),
  );
  app.querySelectorAll("[data-stock]").forEach(
    (b) =>
      (b.onclick = () => {
        stockTab = b.dataset.stock;
        render();
      }),
  );
  app.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        const id = Number(b.dataset.id);
        try {
          upgradeAction(b.dataset.action, id);
          switch (b.dataset.action) {
            case "logout":
              await api("logout", {});
              localStorage.removeItem("grain-sales-cache");
              state = null;
              login();
              break;
            case "sync":
              await sync();
              break;
            case "new-order":
              orderForm();
              break;
            case "verify":
              orderForm(state.orders.find((o) => o.id === id));
              break;
            case "new-purchase":
              purchaseForm();
              break;
            case "new-run":
              runForm();
              break;
            case "batch-register":
              batchRegisterForm(id);
              break;
            case "overhead":
              overheadForm(id);
              break;
            case "payment":
              paymentForm(id);
              break;
            case "make-invoice":
              confirmForm(
                "Create GST invoice",
                "Create an immutable invoice from the approved quantities and prices? Stock will reduce only when dispatched.",
                "invoice",
                id,
              );
              break;
            case "dispatch":
              await dispatchForm(id);
              break;
            case "credit":
              showForm(
                "Issue a full credit note",
                field("Cancellation reason", "reason", "", "text", "required"),
                (p) => mutate("credit", { ...p, id }),
                "Issue credit note",
              );
              break;
            case "new-master":
              masterForm();
              break;
            case "new-bom":
              bomForm();
              break;
          }
        } catch (err) {
          toast(err.message);
        }
      }),
  );
  const form = document.querySelector("#report-form");
  if (form) {
    const updateFilters = () => {
      const type = form.elements.type.value;
      const scopes = {
        customer_id: [
          "sales",
          "customer-sales",
          "product-sales",
          "gst",
          "collections",
          "outstanding",
          "refunds",
        ],
        batch_id: [
          "sales",
          "customer-sales",
          "product-sales",
          "gst",
          "production",
          "costing",
          "collections",
          "outstanding",
          "expiry",
          "refunds",
        ],
      };
      for (const [name, types] of Object.entries(scopes)) {
        form.elements[name].disabled = !types.includes(type);
        if (form.elements[name].disabled) form.elements[name].value = "";
      }
    };
    form.elements.type.onchange = updateFilters;
    updateFilters();
  }
  if (form)
    form.onsubmit = async (event) => {
      event.preventDefault();
      const p = Object.fromEntries(new FormData(form));
      reportFilters = {
        customer_id: p.customer_id || "",
        product_id: p.product_id || "",
        batch_id: p.batch_id || "",
      };
      reportType = p.type;
      from = p.from;
      to = p.to;
      try {
        report = await api(
          "report?" +
            new URLSearchParams({
              type: reportType,
              from,
              to,
              ...reportFilters,
            }),
        );
        render();
      } catch (err) {
        toast(err.message);
      }
    };
}
window.addEventListener("online", () =>
  sync().catch((err) => toast(err.message)),
);
window.addEventListener("offline", () => state && render());
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
try {
  await refresh();
  await sync();
} catch (err) {
  if (!err.status) {
    const cached = localStorage.getItem("grain-sales-cache");
    if (cached) {
      state = JSON.parse(cached);
      page = "orders";
      render();
    } else login();
  } else login();
}
