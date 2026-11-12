# Event followups and approved WhatsApp campaigns

Original scope was local-only. On 2026-11-12 the owner explicitly requested push and Production deployment. This authorizes release of the completed verified feature and its isolated additive migration0138. Real customer messages remain unauthorized and are never sent as a release check.

## Design and audit

Reuse `customer_followups`, its assignment/permission/error boundary, source booking conversion, immutable events, customer contact preferences and notification infrastructure. Preserve legacy four-state conversion contract; an additive contact-stage column represents the detailed occasion lifecycle. Add expected occasion date and expose source booking and history. Existing followup routes remain valid.

Reuse graduation_groups and graduation_orders, their customer/representative and authoritative stored payment-state fields. Group messages expose aggregate information to the group's stored representative only. Individual orders expose their own information only; no student lists, private notes, join tokens, measurements or internal UUIDs are included. Read financial fields without changing financial logic.

Reuse WhatsApp provider environment configuration and whatsapp_log. Existing raw-text/OTP sender stays unchanged. New campaigns use official Meta template sending only, or audited manual WhatsApp opening; opening is never called delivered. Explicit phone consent is scoped to the canonical party, checked again at dispatch along with opt-out and unchanged source phone. Campaign approval covers an immutable per-recipient content snapshot. No financial writes.

Necessary additive migration: followup occasion fields; campaign, recipient/outbox, phone consent and audit records. Unique operation tokens and recipient keys prevent duplicate drafts and recipients. Row locks and durable dispatch claims prevent concurrent sends. An interrupted/ambiguous send becomes unknown and is never automatically retried. Meta delivery webhooks require signature verification and known provider message IDs. Manager role plus existing WhatsApp/customer permissions gate approval and dispatch.

UI extends existing route and sidebar entry to متابعة المناسبات والإرسال الجماعي. Occasion list remains the default; campaigns have recipient search/filter, eight templates, per-person WhatsApp preview, schedule, submission/approval, manual opening, history. Existing staff assignment scope is retained. Synthetic preview uses the actual components and a fixture HTTP backend, never production fallback data.

Blast radius: new endpoints are nested under existing /admin/customer-followups early-auth boundary. Existing followup callers are admin page, staff page, header reminder and booking conversion. Only optional fields are added to their response. Original booking save callback and central smart-notification cron are the only planned shared callers; automatic followups run bounded/idempotently and source errors remain explicit. Payment, stock, cashbox, payroll and invoice formulas are unchanged.

## Implementation sequence

1. Domain tests for scoped templates, statuses, consent, normalized duplicate recipients, immutable approval, delivery progression; observe RED then GREEN.
2. Add isolated migration and schema, implement bounded recipient projection and transactional campaign lifecycle; controlled executor tests and local DB tests.
3. Official Meta adapter, signature-verified delivery status webhook, due campaign worker integrated with existing authenticated cron. Verify provider payload and duplicate/ambiguous handling without external sends.
4. Extend occasion lifecycle, customer history, automatic engagement suggestions/reminders using existing data and notifications.
5. Build responsive existing-page UI, interactive synthetic preview, desktop/mobile browser tests.
6. Run typecheck, focused tests, build, verify:critical; test:save-smoke only on separately verified TEST database, otherwise SKIPPED. Final fresh review and report exact limitations and files.

## Acceptance and operational limits

No API send without live Meta-approved template, existing Meta credentials, explicit consent, manager approval, due schedule and permission revalidation. No fake delivery status. Existing daily cron processes scheduled work on the next daily sweep; authorized manual processing can run sooner. No automatic contact merely because a followup was generated. Provider setup and Production migration are intentionally not applied by this local-only task.
