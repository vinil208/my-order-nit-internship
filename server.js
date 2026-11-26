import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadEnvFile } from "node:process";
import { Factory, passwordMatches, rupees, decimal } from "./domain.js";
import { pdf, csv } from "./pdf.js";
import { assistantHealth, askAssistant } from "./assistant.js";
const root = dirname(fileURLToPath(import.meta.url));
export function createApp(
  dbPath = join(root, "data", "factory.sqlite"),
  { assistantEnv = process.env, assistantFetch = fetch } = {},
) {
  if (dbPath !== ":memory:")
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const f = new Factory(dbPath),
    attempts = new Map(),
    assistantRequests = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, data, type = "application/json", extra = {}) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
        ...extra,
      });
      res.end(type === "application/json" ? JSON.stringify(data) : data);
    };
    try {
      let body = {};
      if (req.method === "POST") {
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}` &&
          req.headers.origin !== `https://${req.headers.host}`
        )
          return send(403, { error: "Origin rejected." });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send(415, { error: "JSON required." });
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 100000) throw Error("Request too large.");
        }
        body = JSON.parse(raw || "{}");
        if (!body || typeof body !== "object" || Array.isArray(body))
          return send(400, { error: "Request body must be a JSON object." });
      }
      const token = (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("session="))
        ?.slice(8);
      const u = token
        ? f.get(
            "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
            token,
            Date.now(),
          )
        : null;
      if (url.pathname === "/api/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress,
          hit = attempts.get(ip) || { count: 0, until: Date.now() + 60000 };
        if (hit.until < Date.now()) {
          hit.count = 0;
          hit.until = Date.now() + 60000;
        }
        hit.count++;
        attempts.set(ip, hit);
        if (hit.count > 20)
          return send(429, {
            error: "Too many login attempts. Try again in one minute.",
          });
        const user = f.get(
          "SELECT * FROM users WHERE username=?",
          String(body.username),
        );
        if (!user || !passwordMatches(String(body.password), user.password))
          return send(401, { error: "Incorrect username or password." });
        const session = randomBytes(32).toString("hex");
        f.exec("DELETE FROM sessions WHERE expires<?", Date.now());
        f.insert("sessions", {
          token: session,
          user_id: user.id,
          expires: Date.now() + 8 * 3600000,
        });
        attempts.delete(ip);
        return send(
          200,
          { id: user.id, name: user.name, role: user.role },
          "application/json",
          {
            "Set-Cookie": `session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
          },
        );
      }
      if (url.pathname === "/api/logout" && req.method === "POST") {
        if (token) f.exec("DELETE FROM sessions WHERE token=?", token);
        return send(200, { ok: true }, "application/json", {
          "Set-Cookie":
            "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        });
      }
      if (url.pathname.startsWith("/api/")) {
        if (!u) return send(401, { error: "Please sign in." });
        if (url.pathname === "/api/assistant/status" && req.method === "GET")
          return send(200, await assistantHealth(assistantEnv, assistantFetch));
        if (url.pathname === "/api/assistant" && req.method === "POST") {
          const now = Date.now();
          const usage = assistantRequests.get(u.id) || {
            count: 0,
            until: now + 60000,
            busy: false,
          };
          if (usage.busy)
            return send(429, { error: "Please wait for your current answer." });
          if (usage.until < now) {
            usage.count = 0;
            usage.until = now + 60000;
          }
          if (usage.count >= 12)
            return send(429, {
              error: "Please wait a minute before asking more questions.",
            });
          usage.count++;
          usage.busy = true;
          assistantRequests.set(u.id, usage);
          try {
            return send(
              200,
              await askAssistant(f, u, body, {
                env: assistantEnv,
                fetchImpl: assistantFetch,
              }),
            );
          } finally {
            usage.busy = false;
          }
        }
        if (url.pathname === "/api/dashboard" && req.method === "GET")
          return send(
            200,
            f.dashboard(
              u,
              url.searchParams.get("from"),
              url.searchParams.get("to"),
            ),
          );
        if (url.pathname === "/api/reconciliation" && req.method === "GET")
          return send(
            200,
            f.reconciliation(u, url.searchParams.get("to") || undefined),
          );
        if (url.pathname === "/api/planner" && req.method === "GET")
          return send(200, f.planner(u));
        if (
          /^\/api\/credit\/\d+\.pdf$/.test(url.pathname) &&
          req.method === "GET"
        ) {
          f.permit(u, ["admin", "accountant", "auditor", "owner"]);
          const c = f.get(
            "SELECT * FROM credits WHERE id=?",
            Number(url.pathname.match(/\d+/)[0]),
          );
          if (!c) throw Error("Credit not found.");
          const i = f.get("SELECT * FROM invoices WHERE id=?", c.invoice_id);
          return send(
            200,
            pdf("CREDIT NOTE", [
              c.number,
              c.date,
              "Original invoice: " + i.number,
              "Reason: " + c.reason,
              "Taxable INR " + rupees(i.taxable),
              "CGST INR " + rupees(i.cgst),
              "SGST INR " + rupees(i.sgst),
              "IGST INR " + rupees(i.igst),
              "Total credit INR " + rupees(c.amount),
              "Financial credit only. Physical returns require a separate stock document.",
            ]),
            "application/pdf",
          );
        }
        if (url.pathname === "/api/state" && req.method === "GET")
          return send(200, f.snapshot(u));
        if (/^\/api\/dispatch\/\d+$/.test(url.pathname) && req.method === "GET")
          return send(200, {
            batches: f.dispatchPreview(
              u,
              Number(url.pathname.split("/").at(-1)),
            ),
          });
        if (url.pathname.startsWith("/api/action/") && req.method === "POST")
          return send(
            200,
            f.act(
              u,
              url.pathname.split("/").at(-1),
              body,
              req.headers["idempotency-key"],
            ),
          );
        if (url.pathname === "/api/report" && req.method === "GET") {
          const r = f.report(
              u,
              url.searchParams.get("type") || "sales",
              url.searchParams.get("from"),
              url.searchParams.get("to"),
              Object.fromEntries(url.searchParams),
            ),
            format = url.searchParams.get("format");
          if (format === "csv")
            return send(200, csv(r.rows), "text/csv; charset=utf-8", {
              "Content-Disposition": `attachment; filename="${r.type}-${r.from}.csv"`,
            });
          if (format === "pdf")
            return send(
              200,
              pdf(`${r.type.toUpperCase()} REPORT`, [
                `${r.from} to ${r.to}`,
                `Records: ${r.rows.length}`,
                "",
                ...r.rows.flatMap((row, i) => [
                  `Record ${i + 1}`,
                  ...Object.entries(row).map(
                    ([k, v]) => `${k.replaceAll("_", " ")}: ${v}`,
                  ),
                  "",
                ]),
              ]),
              "application/pdf",
              {
                "Content-Disposition": `attachment; filename="${r.type}-${r.from}.pdf"`,
              },
            );
          return send(200, r);
        }
        if (
          /^\/api\/invoice\/\d+\.pdf$/.test(url.pathname) &&
          req.method === "GET"
        ) {
          f.permit(u, ["admin", "accountant", "auditor", "owner"]);
          const id = Number(url.pathname.match(/\d+/)[0]);
          const i = f.snapshot(u).invoices.find((i) => i.id === id);
          if (!i) throw Error("Invoice not found.");
          return send(
            200,
            pdf("TAX INVOICE", [
              "My Order Demo Foods",
              "12 Industrial Estate, Tiruchirappalli, Tamil Nadu 620001",
              "Supplier GSTIN: 33DDDDD0000D1Z5 (dummy)",
              `Invoice: ${i.number} | Date: ${i.date}`,
              `Payment due: ${i.due_date} | Status: ${i.status}`,
              "",
              `Bill to: ${i.customer}`,
              i.address,
              `Customer GSTIN: ${i.gstin || "Unregistered"}`,
              `Place of supply: ${i.state} | Reverse charge: No`,
              "",
              ...i.lines.flatMap((l) => [
                `${l.name} | HSN ${l.hsn}`,
                `${decimal(l.qty)} packets x INR ${rupees(l.price)} = INR ${rupees(l.taxable)}`,
                `GST ${(l.gst / 100).toFixed(2)}% | CGST INR ${rupees(l.cgst)} | SGST INR ${rupees(l.sgst)} | IGST INR ${rupees(l.igst)}`,
                "",
              ]),
              `Taxable value: INR ${rupees(i.taxable)}`,
              `CGST: INR ${rupees(i.cgst)} | SGST: INR ${rupees(i.sgst)} | IGST: INR ${rupees(i.igst)}`,
              `TOTAL: INR ${rupees(i.total)}`,
              ...(i.dispatched
                ? [
                    "",
                    "Dispatched batches (earliest expiry first):",
                    ...f
                      .snapshot(u)
                      .batch_trace.filter((a) => a.invoice_id === i.id)
                      .map(
                        (a) =>
                          `${a.product} | Batch ${a.code} | ${decimal(a.qty)} packets | Mfg ${a.manufactured_on} | Exp ${a.expires_on}`,
                      ),
                    ...(f
                      .snapshot(u)
                      .batch_trace.some((a) => a.invoice_id === i.id)
                      ? []
                      : [
                          "Historical dispatch: batch allocation was not recorded.",
                        ]),
                  ]
                : []),
              "",
              "Authorised signatory: ____________________",
              "Exercise invoice. Dummy identities; GST rate assumed at 5% by the assignment.",
            ]),
            "application/pdf",
            { "Content-Disposition": `inline; filename="invoice-${id}.pdf"` },
          );
        }
        return send(404, { error: "Endpoint not found." });
      }
      const files = {
        "/": "index.html",
        "/app.js": "app.js",
        "/assistant-ui.js": "assistant-ui.js",
        "/styles.css": "styles.css",
        "/sw.js": "sw.js",
        "/manifest.webmanifest": "manifest.webmanifest",
        "/icon.svg": "icon.svg",
      };
      if (req.method !== "GET" || !files[url.pathname])
        return send(404, "Not found", "text/plain");
      const file = files[url.pathname],
        type = file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".svg")
              ? "image/svg+xml"
              : file.endsWith("webmanifest")
                ? "application/manifest+json"
                : "text/html";
      return send(200, readFileSync(join(root, "public", file)), type);
    } catch (e) {
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          event: "request_error",
          method: req.method,
          path: url.pathname,
          status: e.status || 400,
          message: e.message,
        }),
      );
      send(e.status || 400, {
        error: e.message?.includes("FOREIGN KEY")
          ? "Referenced record does not exist."
          : e.message,
      });
    }
  });
  return { server, factory: f };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    loadEnvFile(join(root, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { server } = createApp(process.env.DB_PATH);
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(
      `My Order ready: http://localhost:${port}\nDemo login: admin / Demo@12345`,
    ),
  );
}
