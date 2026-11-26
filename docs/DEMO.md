# My Order — eight-minute demonstration script

Target **7 minutes 50 seconds**, leaving ten seconds of margin. Use a fresh opening dataset and dummy data. Keep the required benchmark sequence unchanged. Do not use the old video as evidence of new features.

| Time | Screen and action | Simple English narration |
|---|---|---|
| 0:00–0:25 | Overview, then source structure | “My Order connects factory orders, materials, production, invoices and payments. Its strength is that each number can be followed back to a real transaction.” |
| 0:25–0:50 | Production login; receive 60 kg flour at 45 | “We start with 100 kg flour at 42 rupees. This purchase adds 60 kg at 45. The system calculates the weighted average.” |
| 0:50–1:35 | Post one run:40 kg flour,10.5 L oil,1.2 kg spice,194 pouches,9 cartons;188 good,6 damaged; valid dates; zero overhead | “The recipe expects 200 packets. We record actual usage and 188 good packets. The six damaged pouches are included in 194 used. The system flags minus 6 percent yield and plus 5 percent oil.” |
| 1:35–2:05 | 390 px mobile; salesman.a places 150 for Retailer A | “The salesman sees only assigned customers. This order is submitted; it has not yet reserved stock.” |
| 2:05–2:45 | Admin approve, invoicePDF, FEFO dispatch | “Approval reserves 150 packets. The invoice is 7500 rupees plus 187.50 CGST and 187.50 SGST. Physical stock decreases only at dispatch, leaving 88.” |
| 2:45–3:05 | Salesman B orders 120; admin approval shortage 32 | “The second customer needs 120 packets, but only 88 are available. Approval is blocked with a 32 packet shortage.” |
| 3:05–3:25 | Record 4000 payment | “The collection is 4000 rupees. Outstanding is 3875.” |
| 3:25–3:55 | Amend run labour 1200,utilities 600 with reason; costing | “Now we allocate final overheads. Materials cost 4055. Total run cost 5855 divided by 188 good packets is 31.14 rupees per packet.” |
| 3:55–4:35 | Auditor reports: sales,GST,stock,production,costing,receivables; CSV/PDF | “These reports use the same posted documents. Dates and filters support review. The auditor cannot edit business transactions.” |
| 4:35–5:10 | Planner shortage 32; approve one 200 packet schedule | “The planner recommends one batch from the current recipe. It checks all materials and purchase shortages. Once approved, scheduled output is counted so the next recommendation does not duplicate it.” |
| 5:10–5:40 | Reconciliation and batch recall | “Reconciliation compares source documents, the ledger and batch balances. Batch recall identifies recorded customers and production. We do not invent supplier lots that were never recorded.” |
| 5:40–6:10 | Mobile offline 3 packet draft, reconnect | “This draft stays on the device while offline. It creates no stock reservation. On reconnect the server checks prices and permissions, then accepts the client ID only once.” |
| 6:10–6:40 | Settings, low stock, expiry; explain split option | “Reorder levels and tolerance are configurable. Strict approval is the default. Split approval can create a linked backorder. Expired stock remains held.” |
| 6:40–7:10 | Separate prepared correction invoice if time; full credit then physical return/refund controls | “A credit changes money, not stock. A physical return is recorded separately and quarantined. Refunds cannot exceed collected money.” |
| 7:10–7:35 | Terminal npm test and npm run benchmark, Git log | “The tests include simultaneous approvals, migration, rollback and role checks. The benchmark is reproduced from transactions, not hardcoded results.” |
| 7:35–7:50 | README limits and run command | “This prototype runs with npm start. Raw-material supplier lots, partial returns and closed accounting periods remain future work. Thank you.” |

Prepare the additional correction invoice in a separate demo dataset so the mandatory benchmark results remain clearly identifiable. Do not publish real customer data. Record actual actions; explanatory narration should not claim a screen implements unverified functionality. All original required reports should remain accessible even if only representative exports fit the narration.
