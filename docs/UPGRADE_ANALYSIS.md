# Upgrade gap analysis — 25 November 2026

Baseline: Node 24 built-in HTTP/SQLite, dependency-free browser modules, SQLite WAL and BEGIN IMMEDIATE transactions. Existing UI and live database retained. Read domain, batches, server, frontend, service worker, assistant, PDF writer, seed, container configuration, documentation and regression tests.

Baseline verification: 52 tests passed, zero failed/skipped after enabling sandbox localhost access. Earlier EACCES HTTP failures were environment restrictions, not application failures.

| Area | Existing | Upgrade required |
|---|---|---|
| Benchmark | All quantities, GST and INR31.14 costing verified | Reproducible standalone benchmark output |
| Reservation | Atomic approval, physical issue only on dispatch, idempotency | Cross-connection concurrency test, cancellation, split backorders, audit events |
| Production | Versioned recipes, unit conversion, actual consumption, overhead amendments | Approved schedules, deterministic demand/material planning, configurable tolerance and additional overhead categories |
| Inventory | Source ledger, weighted average, finished batches/FEFO/expiry | Reorder settings, adjustments/reversals, reconciliation, recall view |
| Finance | GST, payments, full unpaid pre-dispatch credits | Separate financial credit, physical return and refund workflows; discounts |
| Roles | Server checks, scoped salesman data, production restrictions | Separate accountant and auditor identities; 403 authorization responses |
| Offline | Cached mobile shell/masters, persistent retry queue | Visible per-order retry/failure history and browser verification |
| Reports | Ten export types, CSV/PDF, date filters | Separate raw/packaging/finished, costing, expiry and reconciliation; entity filters |
| Documentation | README, two-page design, Docker, demo script | Updated diagrams, API, results, security review and interview answers |

Design decisions: retain integer paisa and thousandths, full transaction rollback and append-only movements. Default approval remains all-or-nothing; opt-in split approval creates a linked remainder order. Production schedules are not stock receipts and do not reserve materials; posting rechecks stock. Returns must reference dispatched batches and remain quarantined until verified. No synthetic raw-material lot provenance will be invented for historical records.

Implementation phases will be committed only after relevant verification. This is a production-oriented prototype, not a claim of statutory compliance or deployment readiness.
