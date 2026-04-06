# Review Notes — DB Selection Deviation

## ADR Deviation: SQLite/libSQL instead of PostgreSQL/Neon

**ADR Reference:** ADR-VPET-001 specified PostgreSQL (Neon Serverless) + Drizzle ORM.

**Actual Implementation:** SQLite via libSQL (Drizzle ORM with `drizzle-orm/libsql` adapter).

### Rationale

1. **MVP phase, local development friendliness.** SQLite requires zero infrastructure setup — no external DB service, no environment variables beyond a file path. This dramatically reduces onboarding friction and CI setup complexity during the MVP iteration cycle.

2. **libSQL is SQLite-wire-compatible with Turso cloud.** The `@libsql/client` driver used in this project can connect to both a local SQLite file (`file:./dev.db`) and a remote Turso instance (`libsql://...`). Switching to production cloud storage is a one-line environment variable change (`DATABASE_URL=libsql://<db>.turso.io`), with no code changes.

3. **Drizzle ORM schema portability.** While the schema currently uses `sqliteTable` from `drizzle-orm/sqlite-core`, migrating to PostgreSQL requires renaming table constructors and adjusting a handful of column types (e.g., `integer(..., { mode: 'timestamp' })` → `timestamp()`). This is a bounded, mechanical migration that can be done when the project outgrows SQLite capacity constraints.

4. **Cost profile.** Neon Serverless PostgreSQL has cold-start latency (~500ms on free tier) that is unacceptable for a real-time pet interaction game. SQLite/Turso has sub-millisecond read latency at the edge.

5. **Data volume.** At MVP scale (< 10,000 users, single-table pet data), SQLite's practical performance ceiling (millions of writes/day) is orders of magnitude beyond current needs. PostgreSQL's advantages (advanced query planner, row-level locking at scale, native JSON operators) are not yet material.

### Migration Path to PostgreSQL (if needed)

1. Replace `drizzle-orm/libsql` with `drizzle-orm/neon-http` in `apps/server/src/db/index.ts`.
2. Replace `sqliteTable` with `pgTable` in `apps/server/src/db/schema.ts`.
3. Replace `integer(..., { mode: 'timestamp' })` columns with `timestamp()`.
4. Update `better-auth` adapter `provider: 'sqlite'` → `provider: 'pg'`.
5. Run `drizzle-kit generate` + `drizzle-kit migrate` against the Neon instance.

### Architect Sign-Off Required

This deviation is documented here per code reviewer guidance. Architect confirmation should be recorded in `docs/arch-decision.md` as an ADR amendment before the project exits MVP phase.
