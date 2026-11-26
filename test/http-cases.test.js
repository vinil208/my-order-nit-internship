import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { setup } from "./helpers.js";
async function app(fn, options = { assistantEnv: {} }) {
  const { server, factory } = createApp(":memory:", options);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const login = async (username) => {
    const r = await post("/api/login", { username, password: "Demo@12345" });
    assert.equal(r.status, 200);
    return { Cookie: r.headers.get("set-cookie").split(";")[0] };
  };
  try {
    await fn({ factory, base, post, login });
  } finally {
    await new Promise((r) => server.close(r));
    factory.db.close();
  }
}

test("HTTP login, cookie protection, logout and session expiry", () =>
  app(async ({ factory, base, post, login }) => {
    assert.equal(
      (await post("/api/login", { username: "' OR 1=1 --", password: "wrong" }))
        .status,
      401,
    );
    const r = await post("/api/login", {
      username: "admin",
      password: "Demo@12345",
    });
    assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    const headers = { Cookie: r.headers.get("set-cookie").split(";")[0] };
    const state = await (await fetch(base + "/api/state", { headers })).json();
    assert.doesNotMatch(JSON.stringify(state.user), /password|token/);
    await post("/api/logout", {}, headers);
    assert.equal((await fetch(base + "/api/state", { headers })).status, 401);
    const expired = await login("admin");
    factory.exec("UPDATE sessions SET expires=0");
    assert.equal(
      (await fetch(base + "/api/state", { headers: expired })).status,
      401,
    );
  }));

test("HTTP login throttles repeated incorrect passwords", () =>
  app(async ({ post }) => {
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await post("/api/login", { username: "admin", password: "wrong" }))
          .status,
        401,
      );
    assert.equal(
      (await post("/api/login", { username: "admin", password: "wrong" }))
        .status,
      429,
    );
  }));

test("HTTP rejects malformed bodies, cross-origin writes, missing keys and unknown actions", () =>
  app(async ({ base, post, login, factory }) => {
    const headers = await login("admin");
    const before = factory.get("SELECT COUNT(*) n FROM orders").n;
    for (const body of [null, [], 42, "bad"]) {
      const r = await post("/api/action/order", body, headers);
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /JSON object/);
    }
    assert.equal(
      (
        await fetch(base + "/api/action/order", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: "{bad",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/action/order", {
          method: "POST",
          headers,
          body: "text",
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await post(
          "/api/action/order",
          {},
          { ...headers, Origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/action/order",
          { customer_id: 1, lines: [{ item_id: 6, qty: 1 }] },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/action/delete",
          {},
          { ...headers, "Idempotency-Key": "bad-action" },
        )
      ).status,
      400,
    );
    assert.equal(factory.get("SELECT COUNT(*) n FROM orders").n, before);
    assert.equal((await fetch(base + "/.env")).status, 404);
    assert.equal((await fetch(base + "/data/factory.sqlite")).status, 404);
  }));

test("HTTP concurrent retries post one order; changed requests return conflict", () =>
  app(async ({ post, login, factory }) => {
    const headers = {
      ...(await login("admin")),
      "Idempotency-Key": "same-concurrent",
    };
    const body = { customer_id: 1, lines: [{ item_id: 6, qty: 3 }] };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post("/api/action/order", body, headers)),
    );
    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal((await r.json()).id, 1);
    }
    assert.equal(factory.get("SELECT COUNT(*) n FROM orders").n, 1);
    assert.equal(
      (
        await post(
          "/api/action/order",
          { ...body, lines: [{ item_id: 6, qty: 4 }] },
          headers,
        )
      ).status,
      409,
    );
  }));

test("all six role sessions expose only permitted data and exports", () =>
  app(async ({ base, login }) => {
    for (const name of [
      "admin",
      "production",
      "salesman.a",
      "salesman.b",
      "auditor",
      "owner",
    ]) {
      const headers = await login(name),
        state = await (await fetch(base + "/api/state", { headers })).json();
      assert.ok(state.user);
      assert.equal(state.user.password, undefined);
      const response = await fetch(
        base + "/api/report?type=stock&from=2020-01-01&to=2099-12-31",
        { headers },
      );
      if (name.startsWith("salesman")) {
        assert.equal(state.stock, undefined);
        assert.equal(state.batches, undefined);
        assert.equal(state.invoices, undefined);
        assert.notEqual(response.status, 200);
      } else if (name === "production") {
        assert.deepEqual(state.customers, []);
        assert.equal(state.invoices, undefined);
        assert.notEqual(response.status, 200);
      } else assert.equal(response.status, 200);
    }
  }));

test("all ten report routes produce valid JSON, CSV and PDF with reconciled data", () =>
  app(async ({ factory, base, login }) => {
    const { act, production, invoice } = setup(factory);
    act(2, "production", production());
    const inv = invoice();
    act(1, "dispatch", inv);
    act(1, "payment", { invoice_id: inv.id, amount: 100, reference: "TEST" });
    act(2, "purchase", {
      item_id: 1,
      qty: 1,
      rate: 45,
      supplier_id: 1,
      reference: "TEST",
    });
    const headers = await login("auditor");
    for (const type of [
      "sales",
      "customer-sales",
      "product-sales",
      "gst",
      "stock",
      "ledger",
      "production",
      "purchases",
      "collections",
      "outstanding",
    ])
      for (const format of ["json", "csv", "pdf"]) {
        const response = await fetch(
          base +
            `/api/report?type=${type}&from=2020-01-01&to=2099-12-31&format=${format}`,
          { headers },
        );
        assert.equal(response.status, 200, `${type} ${format}`);
        if (format === "json")
          assert.ok((await response.json()).rows.length > 0);
        else {
          const text = await response.text();
          assert.ok(text.length > 0);
          if (format === "pdf") assert.ok(text.startsWith("%PDF-1.4"));
          else assert.match(response.headers.get("content-type"), /text\/csv/);
        }
      }
  }));

test("assistant rejects concurrent questions and recovers after upstream failure", async () => {
  let resolveFirst, entered;
  const arrived = new Promise((r) => (entered = r));
  let calls = 0;
  await app(
    async ({ post, login }) => {
      const headers = await login("admin");
      const pending = post("/api/assistant", { message: "stock" }, headers);
      await arrived;
      assert.equal(
        (await post("/api/assistant", { message: "stock" }, headers)).status,
        429,
      );
      resolveFirst({ ok: false, status: 500 });
      assert.notEqual((await pending).status, 200);
      const next = await post("/api/assistant", { message: "stock" }, headers);
      assert.equal(next.status, 200);
      assert.equal(calls, 2);
    },
    {
      assistantEnv: { AI_PROVIDER: "ollama" },
      assistantFetch: async () => {
        calls++;
        if (calls === 1) {
          entered();
          return new Promise((r) => (resolveFirst = r));
        }
        return {
          ok: true,
          json: async () => ({
            done: true,
            message: {
              content: JSON.stringify({ answer: "Available", source_ids: [] }),
            },
          }),
        };
      },
    },
  );
});
