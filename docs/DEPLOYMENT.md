# Deployment and security review

## Local demo

Use Node 24+, `npm start`, then localhost:3000. No install/build is needed. Environment variables: HOST (default 127.0.0.1), PORT (3000), DB_PATH (data/factory.sqlite), COOKIE_SECURE (true behind HTTPS). `.env.example` uses local lookup; no AI service is required. Copy it to ignored `.env` only if needed.

`npm run benchmark` is isolated. `node benchmark.js --database data/new-demo.sqlite` creates a fresh persistent benchmark and refuses existing files. Never reset a working database to demonstrate the task. Migrations run automatically in a transaction; stop the server and take a backup before upgrading an important dataset. A stopped SQLite database can be copied with its remaining `-wal`/`-shm` sidecars. Restore to a new path and verify reconciliation before use.

## Docker

```sh
docker compose up --build
```

The image uses Node24 Alpine as a non-root user and a named database volume. Compose binds the host port to loopback. Docker source configuration was reviewed and updated to include all modules; it was not executed in this environment. It is not a claimed deployment.

## Security controls reviewed

| Boundary | Implemented evidence | Limit |
|---|---|---|
| Identity | Salted scrypt, constant-time hash comparison, opaque expiring sessions | Demo accounts only; no MFA/password reset/admin provisioning UI |
| Authorization | Every mutation checks allowed roles; salesman customer/order scoping; production financial data excluded | DB file owner remains trusted |
| Requests | Origin checking, SameSite/HttpOnly cookie, JSON/body limits, input validation | HTTPS/secure cookie needs deployment configuration |
| Injection | Bound SQL values, validated table choices, escaped UI text, CSP, CSV formula protection | Basic Latin PDF fonts; no claim of independent penetration testing |
| Transactions | BEGIN IMMEDIATE, WAL, busy timeout, atomic idempotency, source-reference checks | Single-server SQLite; no distributed/multi-region deployment |
| History | Immutable stock/invoice fields, audit events, retained credits and reversals | Not tamper-evident against a privileged DB operator |
| Offline | User-scoped queue, stale price/permission validation, exact retries | Browser localStorage is unencrypted; app must be open to sync |
| Secrets | Environment variables and ignored .env; no real credentials used | Seeded demo passwords must be replaced for real operation |

Use only dummy data for this internship prototype. Real operation additionally needs non-demo identity management, HTTPS, backups/restore drills, monitoring, retention policy, load testing, accounting-period control and review of actual factory/tax configuration. No statutory compliance, hosted uptime or production-readiness certification is claimed.

## Publication

The local Git history contains real development commits. Create an empty public repository, set its remote and push the existing branch; do not upload a single flattened commit. No remote/account was supplied in this task, so nothing was published. Replace the old demo link only after recording/uploading the updated script. The local startup command meets the brief's local-run option.
