# My Order — design note

## 1. Architecture and transaction boundary

Node.js 24 serves a responsive browser and an authenticated HTTP API. SQLite WAL is authoritative. All writes pass through Factory.act using BEGIN IMMEDIATE and a five-second busy timeout. Source documents, stock movements, audit events and idempotency results commit or roll back together. Matching retries return the original response; a changed payload with the same key conflicts.

Seven dummy accounts represent six roles: admin, production, salesman, accountant, auditor and owner. Salesmen see assigned customers and their own orders. Production cannot see or modify invoices. Accountant can collect, credit and refund; auditor and owner are read-only. Passwords use salted scrypt; cookies are HttpOnly, SameSite and time-limited.

## 2. Model and quantity controls

Customers link to orders; an approved order links to one invoice, payments, an optional full credit, refunds and an optional physical return. Items link to receipts, versioned BOMs, runs and ledger movements. Runs link to finished batches; dispatch allocations connect batches, invoices and customers. Plans retain a BOM version and completed run. Adjustments reference their item/batch and optional original reversal document. Settings and user audit records complete the model. Full ER and system diagrams are maintained in docs/ARCHITECTURE.md.

Order/invoice lines and BOM/run component snapshots are validated JSON with stable item IDs. Closing stock is opening plus receipts minus issues plus adjustments. Approved/invoiced order lines are the reservation source; only dispatch reduces physical stock. Available excludes held batches and active reservations. Optional split approval creates a linked submitted remainder. DB triggers block negative stock and ledger/invoice quantity or amount overwrites.

Finished batches retain manufacturing/expiry dates. FEFO dispatch records allocations; expired, undated and future-manufactured stock is held. Physical returns create quarantine stock independently of a financial credit. Supplier material lots were not recorded and cannot be reconstructed by recall.

## 3. Planning and production

The deterministic planner subtracts eligible free stock and approved scheduled output from submitted demand, adding any reservation deficit caused by expiry. Batches equal ceiling(shortage / BOM yield). Required materials use BOM quantities times batches. Existing schedules consume the planning material pool first; shortages produce purchase recommendations. Cost estimates combine current material values with overheads scaled from the latest completed run; missing cost history is explicit. Admin approval creates a schedule, not stock or a material reservation; posting rechecks materials and completes the plan atomically.

Runs preserve their BOM version, expected/actual quantities and tolerance. Consumption variance is (actual-standard)/standard; yield variance is (good-expected)/expected. Zero denominators are guarded. Failed zero-output runs require a reason and retain consumed cost as failed-run cost. No good inventory value is created.

## 4. Costing and benchmark

Quantities use integer thousandths; pieces/packets are whole. Money uses integer paisa with BigInt intermediate products and half-up rounding. Dimensional conversions support g/kg, ml/litre and configured cartons/packets. Moving weighted average is understandable for interchangeable small-factory materials; each new production issue freezes the applicable value at posting.

Benchmark flour average: (100 x INR 42 + 60 x INR 45) / 160 = INR 43.125/kg. Actual costs are flour 1725 + oil 1470 + spice 240 + pouches 485 + cartons 135 = INR 4055. Labour 1200 + utilities 600 gives INR 5855 / 188 = INR 31.14 per good packet. Damaged pouches are already included in actual consumption. Nine cartons are the actual recorded consumption; eight packets may remain outside full cartons. Opening 50 finished packets use an assumed INR 25 value.

Overhead amendments log before/after values and replay operational finished-stock/dispatch valuation. They do not change material quantities. There are no closed periods or archived valuation revisions. The benchmark adds overhead after invoice, dispatch and INR 4000 collection: taxable 7500, CGST 187.50, SGST 187.50, total 7875, outstanding 3875; closing finished 88, next demand 120, shortage 32.

## 5. Financial integrity, reconciliation and limits

Invoices freeze prices, discounts, GST and fiscal-year numbers. A full credit reverses the receivable without adding stock. Physical returns and bounded refunds are separate documents. Reconciliation compares source quantities with movements, receipt values, batch balances, invoice sums and payment/refund limits. Missing/duplicate references and negative balances are exceptions, never automatic repair.

Seventeen dated JSON/CSV/PDF report choices cover the fifteen requested categories. Offline mobile drafts persist locally and use idempotent sync with current price/customer validation. No reservation is implied offline. New migrations are additive and tested for repeated upgrade without balance changes.

This is an operational prototype with dummy data. Limits: item-level raw-material traceability, full returns/credits only, no WIP, capacity optimization, double-entry accounts, period locks or statutory filing. Offline data is unencrypted; PDF fonts are basic Latin. Real operation requires non-demo credentials, HTTPS, backups and factory/tax review. No hosted deployment is claimed.
