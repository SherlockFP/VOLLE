# Payments (Stripe Checkout for gems)

Real-money purchases sell **gems** only. Gems buy direct, non-random items (today:
the Premium Battle Pass). Gems can never open cases or buy case keys — enforced by
`server/profile-store.js#spendGems` and `tests/loot-box-policy.test.cjs`.

The whole flow is **off** until the environment variables below are set. With no
keys the Shop > Gems tab shows the packs with "Coming soon" and no buy button,
and `POST /api/payments/checkout` answers `503 payments unavailable`.

## How it works

1. Player (signed-in account only — guests get `401` and the free-account prompt)
   presses **Buy** in Shop > Gems.
2. Browser → `POST /api/payments/checkout { packId, requestId }`.
3. Server looks the pack up in the **one server catalog**
   (`PREMIUM_PACKS` in `server/payment-ledger.js`), then creates a Stripe Checkout
   Session with `fetch` against `https://api.stripe.com/v1/checkout/sessions`
   (form-encoded, no SDK). Price, currency and gem count come from the server;
   the browser only sends a pack id. Session metadata carries `app=volle`,
   `packId`, `profileId`, `accountId` and the `requestId` (also used as the Stripe
   `Idempotency-Key`); `client_reference_id` is the profile id.
4. Browser is sent to the Stripe-hosted page (the client only accepts
   `https://*.stripe.com` URLs).
5. Stripe calls `POST /api/payments/stripe/webhook`. The server verifies the
   `Stripe-Signature` header (HMAC-SHA256 of `t.rawBody` with
   `STRIPE_WEBHOOK_SECRET`, constant-time compare, 5-minute tolerance) on the raw
   request bytes, then on `checkout.session.completed` /
   `checkout.session.async_payment_succeeded` with `payment_status=paid` credits
   gems through `PaymentLedger.apply` → `ProfileStore.grantPremium`. The Checkout
   Session id is the idempotency key, so Stripe retries and duplicate events
   credit exactly once. The paid amount must equal the catalog price or the
   grant is refused (`409`).
6. Stripe redirects to `/?purchase=success` (or `/?purchase=cancel`). The game
   shows a toast, re-syncs the profile a few times until the gems arrive and
   strips the query string.

Products and prices are **not** created in the Stripe dashboard. To change a price
or add a pack, edit `PREMIUM_PACKS` (bonus % and "Best value" are derived).
Gem prices for items live next to it in `GEM_PRICES`.

The older provider-neutral webhook (`POST /api/payments/webhook`,
`X-Payment-Signature`, `PAYMENT_WEBHOOK_SECRET`) still works for a non-Stripe
provider or manual grants; Stripe does not use it.

## Environment variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` / `sk_live_…` (or a restricted `rk_…` key with Checkout Sessions write) | Creates Checkout Sessions. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Verifies webhook signatures. Different for test and live endpoints and for `stripe listen`. |
| `PUBLIC_BASE_URL` | `https://volle.onrender.com` | Origin used for success/cancel URLs. Must be `https` (plain `http` only for `localhost`). |

Checkout is enabled only when both `STRIPE_SECRET_KEY` and `PUBLIC_BASE_URL` are
valid. The webhook is enabled only when `STRIPE_WEBHOOK_SECRET` is set. Values are
read per request, so a restart after changing them is enough. On Render they are
declared in `render.yaml` with `sync: false` — set them in the dashboard.

## Owner setup

1. Create a Stripe account at <https://dashboard.stripe.com/register> and stay in
   **Test mode** (toggle top-right).
2. Developers → API keys → copy the **Secret key** (`sk_test_…`).
3. Developers → Webhooks → **Add endpoint**:
   - URL: `https://<your-domain>/api/payments/stripe/webhook`
   - Events: `checkout.session.completed` and
     `checkout.session.async_payment_succeeded`
   - Copy the endpoint's **Signing secret** (`whsec_…`).
4. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `PUBLIC_BASE_URL` on the
   host (Render → Environment) and redeploy.
5. Settings → Public details: set the business name and statement descriptor
   buyers will see.

## Testing in test mode

- Local: `STRIPE_SECRET_KEY=sk_test_… PUBLIC_BASE_URL=http://localhost:8000 npm start`,
  then forward webhooks with the Stripe CLI:
  `stripe listen --forward-to localhost:8000/api/payments/stripe/webhook` and use
  the `whsec_…` it prints as `STRIPE_WEBHOOK_SECRET`.
- Test cards (any future expiry, any CVC, any postcode):
  - `4242 4242 4242 4242` — succeeds.
  - `4000 0025 0000 3155` — requires 3-D Secure authentication.
  - `4000 0000 0000 9995` — declined (insufficient funds).
- Check: gems appear after the redirect; resending the event from Dashboard →
  Webhooks → the event → **Resend** must not add gems again.
- Automated tests mock Stripe (`tests/stripe-payments.test.cjs`); they never hit
  the network.

## Go-live checklist

- [ ] Stripe account activated (business details, bank account, identity).
- [ ] Real **Terms of Sale** and **Privacy Policy** pages published and linked
      from the Gems tab (currently text placeholders in `js/gem-shop.js`).
- [ ] Legal review of: "purchases are final" wording vs. EU/UK 14-day withdrawal
      rules for digital content (add an explicit consent/waiver step if required),
      minimum age / parental consent, loot-box rules (gems already cannot reach
      cases).
- [ ] Tax: decide on Stripe Tax or a merchant of record for VAT/sales tax. If Stripe
      Tax is enabled, keep prices tax-exclusive or update the ledger check (it
      compares `amount_subtotal` to the catalog price).
- [ ] Refund/dispute process: refunds are handled in the Stripe dashboard; gems
      are **not** clawed back automatically — support removes them manually.
      Session metadata (`profileId`, `packId`) is mirrored on the PaymentIntent.
- [ ] Switch to live keys: live `sk_live_…`, a **new live-mode webhook endpoint**
      and its own `whsec_…`, `PUBLIC_BASE_URL` = production origin.
- [ ] `DATA_DIR` on a persistent disk (the payment ledger and profiles live
      there) and backups enabled.
- [ ] Make one small real purchase, confirm the gem credit, then refund it.
