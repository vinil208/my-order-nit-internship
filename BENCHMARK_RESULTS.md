# Benchmark results

Executed on 2026-11-26 with Node 24 against a fresh in-memory database. **All benchmark assertions passed.** Values below were read from posted transactions, not substituted into application calculations.

Run `npm run benchmark` or `node benchmark.js --database data/new-benchmark.sqlite` (requires a new path).

| Metric | Actual |
|---|---:|
| flour kg | 120 |
| oil litre | 19.5 |
| spice kg | 3.8 |
| pouches | 306 |
| cartons | 21 |
| finished after production | 238 |
| finished after dispatch | 88 |
| yield variance pct | -6 |
| oil variance pct | 5 |
| taxable inr | 7500 |
| cgst inr | 187.5 |
| sgst inr | 187.5 |
| total inr | 7875 |
| paid inr | 4000 |
| outstanding inr | 3875 |
| shortage packets | 32 |
| material cost inr | 4055 |
| run cost inr | 5855 |
| cost per packet inr | 31.14 |
| reconciliation | Reconciled |

The expected comparison is in README and the assertions in benchmark.js. Machine-readable evidence: [benchmark-results.json](docs/benchmark-results.json).

Sequence verified: purchase, production with zero overhead, mobile salesman A order, admin approval/invoice/dispatch, salesman B shortage, collection, then overhead amendment. Reconciliation contains zero unexplained differences. All seventeen report types generated successfully; empty refunds are expected in the unchanged benchmark.

Cost uses moving weighted-average flour at INR 43.125/kg. Actual materials/packaging 4055 + overhead 1800 =5855 /188 =31.143617..., rounded 31.14. Six damaged pouches are included in 194 consumed pouches. Nine cartons are actual consumption; eight good packets can remain outside full cartons. Opening finished goods are assumed INR 25/packet solely for inventory valuation.
