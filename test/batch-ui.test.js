import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Factory } from "../domain.js";

test("batch interface renders held stock, escaped labels, dates and role-specific controls", () => {
  const f = new Factory();
  try {
    const context = vm.createContext({
      document: { querySelector: () => ({}) },
      AssistantPanel: class {
        constructor() {}
      },
      Intl,
      console,
    });
    const source = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    )
      .replace(/^import[^\n]+\n/, "")
      .split('window.addEventListener("online"')[0];
    vm.runInContext(source, context);
    const snap = f.snapshot(f.get("SELECT * FROM users WHERE id=1"));
    snap.batches[0].code = "<script>alert(1)</script>";
    snap.batches[0].legacy = 1;
    snap.batches[0].status = "Needs dates";
    snap.batches[0].manufactured_on = null;
    snap.batches[0].expires_on = null;
    context.inputState = snap;
    const html = vm.runInContext(
      'state=inputState;stockTab="batches";inventory()',
      context,
    );
    assert.match(html, /Batches &amp; expiry|Batches & expiry/);
    assert.match(html, /50 packets need batch dates/);
    assert.match(html, /data-action="batch-register"/);
    assert.match(html, /Dispatch traceability/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    const fields = vm.runInContext("runFields(state.boms[0])", context);
    assert.match(fields, /name="manufactured_on" type="date"/);
    assert.match(fields, /name="expires_on" type="date" value="" required/);
    const readonly = vm.runInContext(
      'state.user.role="owner";inventory()',
      context,
    );
    assert.doesNotMatch(readonly, /data-action="batch-register"/);
    const floor = vm.runInContext(
      'state.user.role="production";inventory()',
      context,
    );
    assert.match(floor, /data-action="batch-register"/);
    assert.doesNotMatch(floor, /Dispatch traceability/);
  } finally {
    f.db.close();
  }
});
