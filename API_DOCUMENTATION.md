# My Order API

Base: the same origin as the browser, normally `http://localhost:3000`. Requests and responses use JSON unless an export is requested. All writes require `Content-Type: application/json`; cross-origin writes are rejected. Login creates an eight-hour HttpOnly, SameSite=Strict session cookie. Never embed secrets in URLs.

## Routes

| Method and path | Purpose |
|---|---|
| POST /api/login | `{username,password}`; sets session cookie |
| POST /api/logout | Ends current session |
| GET /api/state | Server-scoped business snapshot; no password hashes or session tokens |
| POST /api/action/:action | Transactional command; requires `Idempotency-Key` header |
| GET /api/planner | Deterministic recommendations, including required materials |
| GET /api/reconciliation?to=YYYY-MM-DD | Source/ledger reconciliation at cutoff; defaults today |
| GET /api/dashboard?from=...&to=... | Actual revenue, collections, production, profitability and receivables |
| GET /api/dispatch/:invoiceId | Admin FEFO preview before dispatch |
| GET /api/invoice/:id.pdf | Invoice with batch dispatch trace |
| GET /api/credit/:id.pdf | Retained financial credit document |
| GET /api/report?type=...&from=...&to=...&format=... | JSON by default; `csv` or `pdf` |

The retained optional assistant routes are documented in `docs/ASSISTANT.md`; none can post business transactions.

## Transaction commands

Quantities/rates are human decimals in requests. API snapshots return thousandths for quantities, paisa for money and basis points for GST/discount percentages. Use decimal strings for money inputs. IDs must identify existing, authorized records. Every write has one request fingerprint covering action and canonical payload.

| Action | Key payload | Allowed roles |
|---|---|---|
| purchase | supplier_id, item_id, reference, qty, unit optional, rate | admin, production |
| production | bom_id, batches, batch, manufactured_on, expires_on, actual, damaged, components[{item_id,qty,unit}], labour, power, gas, other; plan_id optional; failure_reason for zero output | admin, production |
| order | customer_id, lines[{item_id,qty,unit,expected_price}], notes | salesman for assigned customer, admin |
| approve | id, lines optional, reject/reason optional, partial optional | admin |
| cancelOrder | id, reason; submitted/approved only | admin |
| invoice | id of approved order | admin |
| dispatch | id of posted invoice; expected_batches optional | admin |
| payment | invoice_id, amount, reference | admin, accountant |
| overhead | id, labour, power, gas/other optional, reason | admin, production |
| credit | id, reason; legacy unpaid, undispatched full cancellation | admin |
| financialCredit | id, reason; full posted invoice credit, independent of stock | admin, accountant |
| returnGoods | id, reason; complete physical return from a dispatched invoice | admin |
| refund | id, amount, reference; credited invoice with unrefunded collections | admin, accountant |
| adjustment | item_id, kind(receipt/issue/wastage), qty, rate for receipt, batch_id for finished goods, reason; OR reverses_id and reason | admin |
| configure | fulfillment(strict/split), variance_tolerance; OR item_id, reorder_level, gst/price optional for future transactions | admin |
| approvePlan | product_id, bom_id, batches, scheduled_on, notes | admin |
| cancelPlan | id, reason | admin |
| batchRegister | id of unverified batch, qty, code, manufactured_on, expires_on, reason | admin, production |
| master | type(item/customer/supplier/bom), validated fields from corresponding UI | admin |

Approval line prices and discounts are admin-only. Discount requests use percent (for example `10`), snapshot values use basis points (`1000`). Salesman `expected_price` is the cached price in paisa; a changed master price causes 409 before posting so the salesman can review it. Offline orders never reserve stock before approval.

Example, after obtaining a session:

```http
POST /api/action/order
Content-Type: application/json
Idempotency-Key: client-generated-uuid

{"customer_id":1,"lines":[{"item_id":6,"qty":"150","unit":"packet","expected_price":5000}]}
```

Success returns `{ "id": 1 }`. Exact retries return the same result; reusing a key for a different action/body returns 409. Split approval may also return `backorder_id`. If a later check fails, source documents, movements, audit records and the key result roll back together.

## Reports and filters

Types: `sales`, `customer-sales`, `product-sales`, `gst`, `purchases`, `stock`, `raw-stock`, `packaging-stock`, `finished-stock`, `ledger`, `production`, `costing`, `collections`, `outstanding`, `expiry`, `reconciliation`, `refunds`.

Batch filters are disabled for item-total stock/ledger/purchase/reconciliation reports; use the batch expiry or production reports for batch-specific data. Optional `customer_id`, `product_id` (also material IDs) and `batch_id` filter relevant source documents. Invoice register values are original postings with status; GST and grouped sales include dated credits. Collections are gross receipts; refunds are a separate report. Receivables include payments/credits through `to`. Product-filtered collections/receivables are whole invoices containing the product, not per-product payment allocation. Batch filters on sales select associated invoices and product lines, not an allocation of taxes to individual batches. Inventory values are operational replay values, not archived fiscal-period revisions.

## Errors

401: sign-in required. 403: role/origin denied. 409: conflicting idempotency payload or changed cached price. 415: JSON required. 429: throttled. 400: invalid input, shortage, duplicate business reference, invalid transition or integrity failure. An error never means a successful transaction was silently partially posted. After an uncertain network response, retry the same payload/key or inspect the order book before making a new request.
