# Verification report — 26 November 2026

**65 tests passed; 0 failed; 0 skipped.** Command: `npm test`, Node 24.11.1. Tests use isolated memory/temporary databases. No live database was reset. There is no claim that finite tests cover every possible input or certify production readiness.

## Automated coverage

The retained 52 tests cover the NIT benchmark, arithmetic/rounding, dimensional units, BOM validation, production stock posting, weighted-average valuation, CGST/SGST/IGST, source exports, payment bounds, idempotency, role restrictions, FEFO/expiry, queue behavior, HTTP sessions and assistant permissions.

Thirteen upgrade tests add:

- Independent SQLite connections starting competing approvals together; exactly one succeeds against overlapping stock.
- Opt-in split fulfillment, linked remainder and cancellation release.
- Explicit accountant/auditor permissions and database immutability.
- Version 2-to 3 migration and repeated reopening with identical posted balances.
- Stale offline prices, duplicate supplier/payment references and bounds after carton-to-packet conversion.
- Injected late return failure with full document/batch/movement rollback.
- Expired reserved stock entering demand and forbidden new commands.
- Benchmark shortage 32 recommending one 200 packet batch; scheduled demand counted once.
- Material shortages and retained scheduled BOM version.
- Configurable tolerance, additional overheads, frozen material issue values and failed zero-output runs.
- Independent full financial credit, quarantined physical return and bounded refunds.
- Adjustments/reversals and detection of orphan source references.
- New reports, entity filters, discounts, alerts and owner metrics.

## Actual browser verification

Browser workflows were verified on 25 November before the final numeric guard; no browser code changed afterward.

Headless installed Chrome through Playwright exercised real forms with a fresh isolated database. `npm run test:browser` passed: settings/reorder controls; split approval; schedule approval and production; invoice and FEFO dispatch; collection; credit; physical return; refund; adjustment/reversal; reconciliation; dashboard; seven added report types in CSV/PDF (14 exports); 390 px mobile offline creation and successful reconnect; accountant restrictions; read-only auditor views. **Zero browser page errors.** Evidence: [browser-verification.json](browser-verification.json).

A separate complete mandatory benchmark browser rehearsal also passed: mobile 150 packet order, INR 7875 PDF, dispatch to 88 packets,32 packet shortage, INR 4000 payment, then overhead amendment to INR 31.14; ten original report types exported CSV/PDF.

## Documents, migration and packaging

Design PDF is exactly two pages and both rendered pages were visually inspected. Existing pre-batch fixture was corrected to remove the new movement batch FK when simulating the old schema. No production integrity rule was relaxed. API network tests initially failed with sandbox EACCES; after localhost access was granted, all tests passed.

## Limits

Docker was not run. No load/soak test, third-party penetration test, statutory audit, hosted availability or real tax validation is claimed. Offline is localStorage-based and app-open sync; no encrypted storage/background sync. Browser automation depends on external Playwright/Chrome tooling and is not a runtime dependency. Previous coverage percentages describe the older suite and have not been recomputed for this upgrade.
