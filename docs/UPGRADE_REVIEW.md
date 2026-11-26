# Upgrade review — My Order

The existing Node/SQLite application has been upgraded in place. Branding, core navigation, benchmark behavior and the existing live database were preserved. New operational screens extend the existing design. The final local implementation passes 65 automated tests and actual browser workflows. This is a production-oriented prototype, not a claim of production certification.

## Existing versus upgraded

| Area | Existing | Upgrade delivered |
|---|---|---|
| Reservation | Atomic strict approval and dispatch-only deduction | Independent-connection concurrency test; lock waiting; explicit cancellation/release; opt-in split approval with linked backorder |
| Production | Versioned BOM, actual quantities, fixed tolerance, labour/utilities | Approved schedules; deterministic demand/material planning; historical overhead estimates; configurable tolerance; gas/other costs; explicit failed runs |
| Costing | Weighted-average replay | New material issue values frozen at posting; transparent raw/packaging/overhead/damage breakdown and indicative margin |
| Inventory | Source movements, finished batches, FEFO, expiry | Reorder levels; low-stock alerts; source reconciliation; adjustments and one-time reversals; recall screen |
| Finance | Invoice/PDF, collections, unpaid pre-dispatch cancellation | Discounts, future price/GST settings; full posted credits; separate quarantined returns; bounded refunds; credit PDFs |
| Offline | Cached salesman data and persistent idempotent queue | Pending/retrying/failed/synced display; price-change conflict and review; actual mobile offline/reconnect verification |
| Roles | Auditor used legacy read-only accountant role | Explicit read-only auditor plus separate financial accountant;403 authorization responses; new command permission tests |
| Reports | Ten reports | Seventeen report choices covering all fifteen requested categories; relevant filters; CSV/PDF; owner date metrics |
| Delivery | Existing docs and video | Reproducible benchmark command; expanded tests; API/security/deployment docs; diagrams; two-page design; thirty interview answers; updated 7:50 script |

## Deliverable index

1. **Feature comparison:** table above.
2. **Implemented improvements:** table above and README feature groups.
3. **Modified/new files:** `CHANGED_FILES.md` alongside this review.
4. **Schema changes:** `migrations.js`, version 3; documented in `ARCHITECTURE.md`.
5. **System architecture:** Mermaid in `ARCHITECTURE.md` and README.
6. **ER diagram:** Mermaid in `ARCHITECTURE.md`.
7. **Actual benchmark:** root `BENCHMARK_RESULTS.md` and `docs/benchmark-results.json`.
8. **Actual tests:** root `TEST_REPORT.md` and `docs/browser-verification.json`.
9. **Security review:** `DEPLOYMENT.md`, including implemented protections and operational limits.
10. **Remaining limitations:** below and README.
11. **Execution/deployment:** `npm start`; `npm run benchmark`; Docker Compose supplied but unexecuted.
12. **Evaluation estimate:** below; subjective and not a NIT grade.
13. **Demo script:** `DEMO.md`,7 minutes 50 seconds.
14. **Thirty interview answers:** `INTERVIEW.md`.
15. **Git history:** real commits summarized below; the download includes a complete repository-history.bundle.

## Verified outcomes

65 passed,0 failed,0 skipped. The concurrency test starts two separate SQLite connections together against overlapping stock; exactly one approves. Migration tests preserve balances across upgrades/reopening. Forced late failures roll back source records and stock together. Browser verification completed settings, split orders, schedules, production, financial corrections, reconciliation, exports and 390 pxoffline/reconnect without page errors.

The mandatory scenario still produces 120 kgflour,19.5 Loil,3.8 kgspice,306 pouches,21 cartons,238 finishedafterproduction and 88 afterdispatch. Invoice 7875, collection 4000, outstanding 3875, shortage 32, cost 31.14 per good packet. These are asserted results read from transactions.

## Schema and engineering decisions

Version 3 adds settings, production_plans, adjustments, stock_returns and refunds; parent backorder references; reorder levels; gas/other overheads; posting timestamp, batch reference and frozen movement value. Foreign keys/checks/indexes and immutability/negative-stock triggers protect posting. Existing records are not reseeded. Legacy timestamps and material lots are not invented.

Reservations remain derived from approved/invoiced order lines inside the write transaction. This avoids an independently mutable reservation balance. Plans retain their recipe but do not reserve materials; posting rechecks inventory. Material cost estimates use current moving-average rates; overhead estimates scale the latest actual run. Missing history is explicitly unknown. Reconciliation compares independent source quantities with movements and checks receipt values, batch totals and financial arithmetic; it is not a double-entry trial balance.

## Remaining limitations and unresolved external steps

- Raw materials are item-level; supplier-lot traceability is unavailable. Finished batch/customer traceability is implemented.
- Returns and credits are full-document only. Split approval/backorders are supported; partial invoice dispatch is not.
- No WIP, sub-recipes, capacity optimization, raw-material reservations, purchase-order approval module, period locks or full double-entry accounting.
- No optional Tally/Tamil work was added; core verification was prioritized.
- Operational valuation can change after overhead amendments. No immutable historical valuation revisions or full temporal batch identity model.
- Demo accounts, unencrypted offline localStorage and basic Latin PDFs remain unsuitable for unrestricted real-data deployment without further work.
- Docker configuration is updated but not runtime-tested. No hosted service or formal security/load certification is claimed.
- Public GitHub/GitLab repository publication is still pending because no account/repository was supplied. The full local history is preserved.
- The older 7:19 video demonstrates the required original scenario. It has not been re-recorded with these upgrade screens. Use the updated script for a refreshed upload.

## NIT evaluation estimate

This is a reasoned self-assessment of the local implementation, **not an official score or a guarantee**. Publication, explanation during interview and evaluator judgment can change it.

| Criterion | Weight | Estimated range | Evidence / remaining risk |
|---|---:|---:|---|
| Benchmark correctness |30|28–30|Reproducible assertions and browser sequence; evaluator rerun still matters |
| Production/inventory |20|17–19|Versioned BOM, planning, weighted average, FEFO, reconciliation; no raw supplier lots/WIP |
| Sales-to-invoice |15|13–14|Reservations, GST/PDF, dispatch, collections, corrections; full-document return limits |
| Model/code quality |15|12–13|Transactions, constraints, modular logic, real tests/history; JSON line storage and full replay tradeoffs |
| Usability |10|8–9|Preserved responsive design and offline workflow; limited user research/localization |
| Reports/documentation |10|8–9|Required exports, diagrams, two-page note and evidence; public links/video refresh pending |
| **Core total** |**100**|**86–94**|Subjective readiness estimate, not an award |
| Stretch |up to 10|5–8|Offline sync, planning, expiry and audit controls; bonus allocation is evaluator-dependent |

## Actual commit summary

- `c0299a0` — verified baseline and gap analysis.
- `509fcd5` — reservations, split backorders and accountant permissions.
- `47398fa` — deterministic planning, reconciliation and financial corrections with connected screens.
- `cb90985` — migration, offline recovery, browser runner, expanded verification and readable module formatting.
- `74e2140` — README, benchmark/test evidence, diagrams, design PDF, API, interview guide and demo script.

A final hardening commit also bounds quantities after carton conversion and records the 26 November regression rerun. The existing earlier commits remain. No fabricated historical dates, synthetic author history, force push or external publication was performed.
