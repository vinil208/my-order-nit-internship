import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fs = require("fs"),
  path = require("path"),
  assert = require("assert/strict"),
  { pathToFileURL } = require("url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "test-artifacts");
fs.mkdirSync(out, { recursive: true });
let browser, server, page, context;
const errors = [];
(async () => {
  const { createApp } = await import(
    pathToFileURL(path.join(root, "server.js"))
  );
  const app = createApp(":memory:");
  server = app.server;
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : process.platform === "win32"
        ? {
            executablePath:
              "C:/Program Files/Google/Chrome/Application/chrome.exe",
          }
        : {}),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Kolkata",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = async (name) => {
    await page
      .locator('[data-page="' + name + '"]')
      .first()
      .click();
  };
  const fill = async (name, v) =>
    page.locator('#modal [name="' + name + '"]').fill(String(v));
  const submit = async () => {
    await page.locator("#modal-form button[type=submit]").click();
    await page.locator("#modal").waitFor({ state: "hidden" });
  };
  const login = async (name) => {
    if (await page.locator("[data-action=logout]").count())
      await page.locator("[data-action=logout]").click();
    await page.locator("[name=username]").selectOption(name);
    await page.locator("#login-form button").click();
    await page.locator("[data-action=logout]").waitFor();
  };
  await page.goto(url);
  await login("admin");
  await nav("settings");
  await page.locator("[data-action=settings-edit]").click();
  await page.locator("#modal [name=fulfillment]").selectOption("split");
  await fill("variance_tolerance", 4);
  await submit();
  await page.locator("[data-action=reorder-edit]").first().click();
  await fill("reorder_level", 120);
  await submit();
  await nav("orders");
  await page.locator("[data-action=new-order]").click();
  await fill("qty", 80);
  await submit();
  await page.locator("[data-action=verify]").click();
  await page.locator("#modal [name=partial]").check();
  await submit();
  assert.equal(app.factory.reserved(6), 50000);
  assert.equal(app.factory.all("SELECT * FROM orders").length, 2);
  await nav("planner");
  await page.screenshot({
    path: path.join(out, "planner.png"),
    fullPage: true,
  });
  await page.locator("[data-action=plan-approve]").click();
  await submit();
  await page.locator("[data-action=plan-run]").click();
  await fill("batch", "UPGRADE-UI-PLAN");
  let expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + 20);
  await fill("expires_on", expiry.toISOString().slice(0, 10));
  await submit();
  assert.equal(app.factory.all("SELECT * FROM runs").length, 1);
  await nav("orders");
  await page.locator("[data-action=make-invoice]").click();
  await submit();
  await nav("invoices");
  await page.locator("[data-action=dispatch]").click();
  await submit();
  await page.locator("[data-action=payment]").click();
  await fill("amount", 100);
  await fill("reference", "UI-PAY");
  await submit();
  await page.locator("[data-action=financial-credit]").click();
  await fill("reason", "Browser correction");
  await submit();
  await page.locator("[data-action=return-goods]").click();
  await fill("reason", "Physical inspection reference");
  await submit();
  await page.locator("[data-action=refund]").click();
  await fill("amount", 100);
  await fill("reference", "UI-REFUND");
  await submit();
  await nav("reconciliation");
  await page.locator("[data-action=adjust-new]").click();
  await fill("qty", 1);
  await fill("reason", "Spillage test");
  await submit();
  await page.locator("[data-action=adjust-reverse]").click();
  await fill("reason", "Measurement corrected");
  await submit();
  assert.equal(
    app.factory.reconciliation(
      app.factory.get("SELECT * FROM users WHERE id=1"),
    ).status,
    "Reconciled",
  );
  await page.screenshot({
    path: path.join(out, "reconciliation.png"),
    fullPage: true,
  });
  await nav("overview");
  await page.locator("#dashboard-form button").click();
  await page.getByText("Gross profit", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(out, "dashboard.png"),
    fullPage: true,
  });
  await nav("reports");
  for (const type of [
    "raw-stock",
    "packaging-stock",
    "finished-stock",
    "costing",
    "expiry",
    "reconciliation",
    "refunds",
  ]) {
    await page.locator("#report-form [name=type]").selectOption(type);
    await page.locator("#report-form button").click();
    await page.waitForTimeout(80);
    for (const format of ["CSV", "PDF"]) {
      const href = await page
        .getByRole("link", { name: "Export " + format, exact: true })
        .getAttribute("href");
      const result = await page.request.get(url + href);
      assert.equal(result.status(), 200);
      const buffer = await result.body();
      if (format === "PDF")
        assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
      fs.writeFileSync(
        path.join(out, type + "." + format.toLowerCase()),
        buffer,
      );
    }
  }
  await login("salesman.a");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await nav("orders");
  await context.setOffline(true);
  await page.locator("[data-action=new-order]").click();
  await fill("qty", 3);
  await submit();
  await page.screenshot({
    path: path.join(out, "offline-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("grain-queue")).length,
    ),
    1,
  );
  await context.setOffline(false);
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem("grain-queue") || "[]").length === 0,
  );
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(out, "synced-mobile.png"),
    fullPage: true,
  });
  assert.equal(app.factory.all("SELECT * FROM orders").length, 3);
  await login("accountant");
  assert.equal(await page.locator("[data-action=new-order]").count(), 0);
  await nav("invoices");
  assert.equal(await page.locator("[data-action=dispatch]").count(), 0);
  await login("auditor");
  for (const name of ["planner", "reconciliation", "recall", "settings"]) {
    await nav(name);
    assert.equal(await page.locator("main [data-action]").count(), 0);
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed: true,
        pageErrors: errors,
        checks: [
          "settings",
          "split-backorder",
          "schedule-approval",
          "planned-production",
          "invoice-dispatch",
          "payment-credit-return-refund",
          "adjustment-reversal",
          "reconciliation",
          "dashboard",
          "7 reports CSV/PDF",
          "390px offline order reconnect",
          "accountant permissions",
          "auditor read-only",
        ],
      },
      null,
      2,
    ),
  );
  console.log("PASS browser upgrade workflows, offline mobile and 14 exports");
})()
  .catch(async (e) => {
    console.error(e);
    if (page) {
      console.error(
        await page
          .locator("#form-error")
          .textContent()
          .catch(() => ""),
      );
      await page
        .screenshot({ path: path.join(out, "error.png") })
        .catch(() => {});
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
  });
