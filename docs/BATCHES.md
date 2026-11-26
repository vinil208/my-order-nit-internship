# Batch and expiry tracking

Open **Inventory → Batches & expiry** to view finished-goods batches, manufacturing dates, expiry dates, remaining packets and dispatch history.

## Production

Every new production run requires a batch number, manufacturing date and expiry date. The batch number must be unique for the product (case-insensitive). Manufacturing cannot be in the future; expiry cannot precede manufacturing. Good output creates the batch and stock receipt in the same transaction. A failure rolls back materials, the run and the batch together.

Enter real dates from your recipe/packaging records. The app does not infer shelf life or calculate safe expiry dates. New demo databases include a clearly named demo opening batch with sample dates; these are demonstration data only.

## Warnings and availability

- **Ready:** dated stock with more than seven days until expiry.
- **Expiring soon:** expires today or within seven days.
- **Expired:** expiry date has passed; blocked from approval availability and dispatch.
- **Needs dates:** existing stock whose batch details were not recorded; blocked until registered.
- **Depleted:** no packets remain in the batch.

Expiry uses the factory's Asia/Kolkata business date. The expiry date itself is the final dispatchable day. Physical stock and accounting value still include expired/undated goods. The Held column separates those goods from available quantity. Availability also excludes quantities reserved by approved/invoiced orders and never becomes negative. Reservations remain product-level; specific batches are selected at dispatch.

## Existing stock

The upgrade preserves transaction records, quantities and values. It groups remaining finished stock into an unverified balance per product. It does not guess historical batch dates or reconstruct unsupported customer-to-batch links.

Admin or production users can select **Register batch** and enter the actual batch number, quantity, manufacturing date, expiry date and verification reference. Register one physical batch at a time; quantities can split the unverified balance into multiple batches. Registration changes neither total stock nor its value and is retained in the audit trail. Expired batches can be registered accurately but remain held.

## Dispatch and traceability

The dispatch preview lists the batches to pick. The server allocates earliest expiry first, then manufacturing date and ID for ties, splitting across batches when needed. Expired and undated stock cannot be selected. Confirmation rechecks availability and expiry in the same transaction as stock issues. If the preview's batch quantities changed, confirmation fails and asks the user to reopen the preview.

Each allocation records its invoice and quantity. **Dispatch traceability** shows the receiving customer, invoice, order and production run where known. Dispatched invoice PDFs include batch numbers, quantities and dates. Historical invoices without allocations explicitly say their batch history was not recorded.

Production users can see batches and register existing stock but cannot see customer dispatch history. Salespeople retain their existing order-only access. Admin dispatches; owner and auditor can read batch history.

## Validation and limits

The test suite covers expiry boundaries, FEFO splitting, stale previews, atomic rollback, duplicate request retries, duplicate batch numbers, date validation, role restrictions, invoice PDFs, migration, and interface rendering, alongside the original benchmark. Browser visual verification was unavailable because the browser-control tool timed out.

This release tracks finished-goods batches. Raw-material lot tracing, recalls, quality release, expiry write-offs, returns, minimum remaining shelf life at delivery and date corrections to posted batches are not implemented. Cost valuation remains moving weighted average; FEFO determines physical dispatch allocation rather than changing accounting valuation.

Latest full regression results: [Test report](TEST_REPORT.md).
