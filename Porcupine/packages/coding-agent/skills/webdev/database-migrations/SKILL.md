---
name: database-migrations
description: Evolve production databases safely with immutable versioned migrations, expand-and-contract changes, transactional backfills, and verified rollback or forward-recovery plans. Use when changing schemas, constraints, indexes, or persistent data.
stack: webdev
---

# Database Migrations

Treat schema evolution as production code. Prefer small, ordered, forward-compatible changes that the current and next application versions can both tolerate.

## When to Use

- Adding, renaming, or removing tables, columns, constraints, or indexes.
- Backfilling or transforming production data.
- Reviewing a deploy that changes both application code and database shape.

## Procedure

1. Inspect the repository's migration tool, naming convention, applied-history table, deployment order, and rollback policy. Do not introduce a second migration system.
2. Create a new ordered migration. Never edit a migration already applied outside an ephemeral local database.
3. Use **expand and contract** for breaking changes: add the new shape, deploy code that can read/write both shapes, backfill idempotently in bounded batches, switch reads, then remove the old shape in a later release.
4. Separate long data backfills from request handling and schema-locking deploy steps. Make one-off jobs resumable, observable, and safe to retry.
5. Gate destructive SQL (`DROP`, `TRUNCATE`, broad `DELETE`/`UPDATE`) behind explicit review, backups, impact estimates, and a recovery plan. Load the safety stack for destructive commands.
6. Test from a production-like schema snapshot: migrate from the previous release, verify constraints and data, run the affected application tests, and rehearse rollback or forward recovery.
7. Document deploy ordering when old and new application versions may overlap during a rolling release.

## Pitfalls

- Editing an applied migration creates divergent databases.
- Combining a table rewrite, backfill, and application cutover in one irreversible step.
- Assuming DDL is transactional on every database.
- Adding a non-null column or index in a way that locks a large hot table.
- A rollback script that loses newly written data is not a safe rollback.

## Verification

- A fresh database and a previous-release database both reach the expected schema through the same ordered migration path.
- The migration is safe to retry or clearly records why it is single-run.
- Old and new app versions remain compatible for the planned deployment window.
- Backfill progress, failure, and restart behavior are tested.
- Backup/restore or forward-recovery instructions are concrete and verified before destructive changes.

## References

- Flyway recommended practices: https://documentation.red-gate.com/fd/recommended-practices-150700352.html
- The Twelve-Factor App, admin processes and dev/prod parity: https://12factor.net/
