# Verification checklist

## Focused checks

Run the existing deterministic A4 guard:

```powershell
pnpm run test:wedding-invoice-layout
```

Then inspect a Booking Center URL with `?type=booking` and test:

- Arabic and long customer names.
- One service and multiple services when supplied by the API.
- Long notes/optional fields without exposing internal notes.
- Large IQD totals and mixed-direction codes/phone numbers.
- Discount, previous payment/deposit, remaining balance.
- Unpaid, partially paid, fully paid, and financially reversed records.
- Browser print button, print preview, and `pdf=1` download.
- No sidebar, navbar, or admin controls in print.
- No blank trailing page, clipped totals, or broken signatures/footer.
- Multi-page behavior if the actual record exceeds one page.

## Mandatory repository checks

```powershell
pnpm run typecheck
pnpm run build
pnpm run verify:critical
```

There is currently no `lint` script in the root `package.json`; report that fact instead of inventing a command.

Run `pnpm run test:save-smoke` only when `AJN_ENV=test`, `ALLOW_TEST_WRITES=true`, and a separately verified `TEST_DATABASE_URL` are configured. Otherwise report **SKIPPED**, never passed.

If payment or accounting code changes, also run:

```powershell
pnpm run test:payment-state
```

Do not commit, push, or deploy when a mandatory critical check fails.

