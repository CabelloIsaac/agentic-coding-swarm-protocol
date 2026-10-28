---
paths:
  - "src/storage/**"
  - "**/migrations/**"
---

Storage layer rules (loaded only when you work here):

- This layer is the only one that touches disk, the database or object storage. Everything else uses the
  repositories.
- Event logs are append-only: a state change is a new event with the same `id`. Never UPDATE or DELETE.
- Every record carries `schema_version`, `id`, `tenant_id`, `created_at` and `actor`.
- Every destructive operation first saves a version with who, when and why.
- Every implementation (files, Postgres) passes the same contract suite. If you add a method, add it to the suite.
- A new migration is irreversible in production: it needs human review (tier T3).
