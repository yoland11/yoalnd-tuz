# AJN production release requirements

## Environment inventory

Production startup validates the required values before serving API health or business responses. It rejects a local/test `DATABASE_URL`, a production URL equal to `TEST_DATABASE_URL`, placeholder/short secrets, non-HTTPS application origins, and process-local rate limiting.

| Variable | Class | Secret | Production requirement / purpose |
|---|---|---:|---|
| `NODE_ENV` | REQUIRED | no | `production` in the deployed runtime. |
| `AJN_ENV` | REQUIRED | no | Must be `production`; `test` is reserved for isolated write tests. |
| `DATABASE_URL` | REQUIRED | yes | Production PostgreSQL URL; never localhost, a test-named database, or `TEST_DATABASE_URL`. |
| `DB_POOL_MAX` | OPTIONAL | no | Bounded pool size; defaults to 5. Coordinate total instances × pool size with the database limit. |
| `RATE_LIMIT_BACKEND` | REQUIRED | no | Must be `postgres` in production. |
| `AUTH_SECRET` / `SESSION_SECRET` / `NEXTAUTH_SECRET` | REQUIRED (one) | yes | At least 32 characters; admin/customer signing and upload/invitation fallback secrets. |
| `APP_BASE_URL` | REQUIRED | no | Canonical HTTPS origin. |
| `CRON_SECRET` | REQUIRED | yes | At least 32 characters; protects scheduled maintenance. |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | REQUIRED (one) | URL public | Storage API origin. |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_ROLE` | REQUIRED (one) | yes | Server-only storage access. Never expose with `NEXT_PUBLIC_`. |
| `SUPABASE_STORAGE_BUCKET` / `SUPABASE_BUCKET` | REQUIRED operationally | no | Public/marketing media bucket. |
| `AJN_CUSTOMER_PRIVATE_BUCKET` / `SUPABASE_CUSTOMER_PRIVATE_BUCKET` | REQUIRED | no | Private customer-photo bucket. |
| `AJN_RESEARCH_PRIVATE_BUCKET` | REQUIRED operationally | no | Private research documents; may be the same private bucket as customer photos. |
| `AJN_DOCUMENT_PRIVATE_BUCKET` | REQUIRED operationally | no | Private scanned identity/contract documents; may reuse the same private bucket. |
| `ULTRAMSG_INSTANCE_ID`, `ULTRAMSG_TOKEN` | REQUIRED | token: yes | Customer OTP transport used by the public OTP flow. |
| `ADMIN_BOOTSTRAP_ENABLED` | OPTIONAL one-time | no | Defaults false. Set true only for the explicit first-admin procedure below. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME` | OPTIONAL one-time | password: yes | Required only while bootstrap is explicitly enabled; remove afterward. |
| `TRUST_PROXY` | OPTIONAL | no | Enable only behind a trusted proxy that overwrites forwarding headers. |
| `PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `VERCEL_URL` | OPTIONAL/PUBLIC | no | URL fallbacks for links and remote printing; `APP_BASE_URL` remains authoritative. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY` | OPTIONAL/PUBLIC | no | Supabase anonymous client access when enabled. |
| `AJN_IMAGE_UPLOAD_SECRET`, `INVITATION_QR_SECRET` | OPTIONAL | yes | Dedicated secrets; otherwise strong auth secret fallback is used. |
| `RESEND_API_KEY`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | OPTIONAL feature | yes except host | Email transport. Configure one complete transport before enabling email-dependent operations. |
| `TWILIO_*`, `META_WA_*`, `WASSENGER_*` | OPTIONAL feature | yes | Alternative WhatsApp notification transports; not used by the current OTP sender. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | OPTIONAL feature | yes | Telegram notifications. |
| `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | OPTIONAL feature | private key: yes | Web-push transport. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSLATE_MODEL` | OPTIONAL feature | key: yes | Research/translation AI. |
| `GOOGLE_TRANSLATE_API_KEY`, `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY`, `AUTO_TRANSLATE_PROVIDER` | OPTIONAL feature | keys: yes | Translation providers. |
| `SEMANTIC_SCHOLAR_API_KEY`, `NCBI_API_KEY` | OPTIONAL feature | yes | Higher research-provider quotas. |
| `SALES_INVOICE_CANCELLATION_APPROVAL_LIMIT` | OPTIONAL | no | Financial approval threshold; review explicitly before release. |
| `AJN_BACKUP_MEDIA_MAX_BYTES`, `AJN_BACKUP_MEDIA_MAX_FILE_BYTES` | OPTIONAL | no | Bounds AJN JSON/media snapshot size. |
| `AJN_DESKTOP_URL`, `AJN_PUBLIC_DIR`, `AJN_UPDATE_ENABLED`, `AJN_DIAGNOSTIC_LOGS` | DESKTOP/DEVELOPMENT | no | Electron/local runtime controls; do not use to weaken production browser security. |
| `EXPO_PUBLIC_API_BASE_URL` | PUBLIC | no | Mobile client API origin. |
| `TEST_DATABASE_URL`, `ALLOW_TEST_WRITES` | TEST ONLY | URL: yes | Dedicated disposable test database and explicit write gate. Never set to production. |
| `PNPM_HOME` | DEVELOPMENT/BUILD | no | Package-manager tooling only. |

## First administrator procedure

1. Apply the complete migration chain to the new production database.
2. Confirm there is genuinely no `admin`, `super_admin`, or `main_manager` record.
3. Temporarily set `ADMIN_BOOTSTRAP_ENABLED=true`, a unique `ADMIN_USERNAME`, a generated 32+ character `ADMIN_PASSWORD`, and `ADMIN_FULL_NAME`.
4. Perform one administrator login. Bootstrap creates an administrator only when no valid administrator exists and the username is unused.
5. Verify the administrator and its permissions, then immediately remove `ADMIN_PASSWORD`, `ADMIN_USERNAME`, and `ADMIN_FULL_NAME`, and set/remove `ADMIN_BOOTSTRAP_ENABLED` (false is the default).
6. Redeploy/restart with the normal environment. Existing disabled, demoted, suspended, or permission-revoked administrators are never modified by bootstrap variables.

Bootstrap passwords are not logged. A failed bootstrap is logged only with redacted error metadata.

## Database connection model

AJN uses one lazily-created `pg.Pool` per server process and one Drizzle instance over that pool. The default pool maximum is 5, idle timeout is 10 seconds, connection timeout is 10 seconds, and idle clients may let the process exit. Drizzle transaction callbacks check out/release clients and rollback on thrown failures. Production capacity must satisfy `maximum concurrent AJN instances × DB_POOL_MAX` plus migration/operational connections; use the provider's pooler endpoint when required by the serverless database provider.

## Rate-limit retention

The existing authenticated daily cron runs smart notifications and a bounded rate-limit cleanup. Each invocation deletes at most 1,000 rows whose `reset_at` is older than 24 hours, ordered through `rate_limit_buckets_reset_at_idx`. Active and recently expired buckets are retained. The operation is safe to rerun. Monitor cron execution; a missed run affects table size, not request enforcement.

## Backup and recovery

The in-application disaster-recovery JSON/media snapshot is useful for selective AJN export/import, and the Electron SQLite client keeps daily local copies with a seven-copy local retention. Neither replaces a managed PostgreSQL and object-storage recovery plan.

Production operations must back up:

- the complete PostgreSQL database, including schema, sequences, data, constraints, and extensions;
- every Supabase/object-storage bucket, especially customer photos, private research files, secure scanned documents, receipts, QR/media, and disaster-recovery exports;
- deployed environment configuration through the secret manager (not inside database dumps);
- Electron SQLite data and exported local backups when the desktop client is authoritative for any offline records.

Recommended minimum: provider point-in-time recovery where available, nightly logical/full database backups, daily object inventory/versioned replication, 30 daily + 12 monthly copies, and one annual copy subject to AJN retention/privacy policy. Encrypt backups, separate backup credentials from application credentials, restrict restores, and keep at least one copy in a separate failure domain.

Restore verification must be quarterly and use an isolated environment: restore PostgreSQL and storage, apply no production writes, run the migration/schema checks, reconcile row/file counts and financial control totals, verify private-file authorization, run the Phase 1/2/3 suites, document recovery time/data loss, then destroy the isolated restore. No production restore was performed during Phase 3.

## Migration validation

Phase 3 validates two disposable databases derived only from `TEST_DATABASE_URL`: a clean database applying every numbered migration, and an upgrade database applying through 0094, inserting legacy records, then applying 0095–0097. It compares all exported Drizzle tables/columns to PostgreSQL metadata, verifies critical indexes/revisions, verifies legacy records and financial values survive, retries 0096 safely, and confirms application requests need no runtime DDL.
