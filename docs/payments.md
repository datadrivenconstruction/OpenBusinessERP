# Online payments (Stripe, Mollie)

Customers can pay an invoice online through a payment link. The link goes into the
invoice e-mail and is printed on the PDF with a QR code, below the bank details.
When the provider confirms the payment, the app books it and marks the invoice
paid or partially paid. Nobody has to enter anything.

## Setup

Settings → Company → **Online payments** (admins only):

| Field | Meaning |
|---|---|
| Provider | Off, Stripe or Mollie |
| Stripe secret key / webhook signing secret | `sk_test_…` / `sk_live_…` and `whsec_…` from the Stripe dashboard |
| Mollie API key | `test_…` or `live_…` |
| Public address of this app | The base URL the provider can reach, e.g. `https://erp.example.com` |
| Page shown after payment | Where the payer is sent after checkout (defaults to the public address) |
| Clearing account | GL account code for money held by the provider. Empty: `1360 Geldtransit` on SKR03, otherwise the sales bank account |

Keys are stored Fernet-encrypted in `<data-dir>/payment_settings.json`. The API
never returns them, and they never go into logs or error messages. The badge next
to the title shows **Test mode** or **Live mode**, based on the key prefix.
**Test connection** makes one read-only call: `GET /v1/balance` for Stripe,
`GET /v2/methods` for Mollie.

### Webhooks

- **Stripe**: add an endpoint `https://<public address>/api/v1/sales/payment-webhooks/stripe/`
  that listens for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
  Copy its signing secret into the settings.
- **Mollie**: nothing to configure. Each payment carries its own `webhookUrl`
  (`…/api/v1/sales/payment-webhooks/mollie/`).

## How it works

1. **Link.** When an invoice that is issued or partially paid is e-mailed, the app
   creates a Stripe Checkout Session or a Mollie payment for the open balance and
   stores it in `oe_sales_payment_link`. An open link is reused while the balance
   stays the same. To create one by hand, call `POST /api/v1/sales/invoices/{id}/payment-link/`.
   If the provider fails, the invoice is still sent, just without a link.
2. **Verification.**
   - Stripe: the `Stripe-Signature` header is checked as HMAC-SHA256 over `t.payload`,
     compared in constant time, with a timestamp tolerance of 5 minutes.
   - Mollie: the webhook only sends a payment id. The app then fetches the payment from
     the Mollie API with its own key, so a forged request proves nothing.
3. **Booking exactly once.** The provider id (Checkout Session id or Mollie `tr_…`)
   is unique per link. A conditional `UPDATE … WHERE status = 'open'` claims the
   link, so retries and concurrent deliveries return `duplicate` and book nothing.
   The payment is booked as *Dr clearing account / Cr receivables*, with method
   `stripe` or `mollie` and the provider id as the reference. Foreign-currency
   invoices go through the usual realized-FX logic.
4. **Edge cases.** Only the open balance is applied. Any excess is logged and left
   unapplied. A payment for an invoice that is no longer open is marked `unapplied`
   and needs to be handled by hand.

## Fees and payouts

Provider fees are not booked by the webhook. Book them when you reconcile the
provider payout on the bank statement:

- *Dr bank / Cr clearing* for the net payout
- *Dr fees / Cr clearing* for the difference

After that, the clearing account returns to zero.
