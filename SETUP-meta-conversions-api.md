# Setup: Meta Conversions API (Browser + Server tracking)

This adds server-side event tracking (Conversions API) alongside the
existing browser Pixel, so every tracked event is sent twice — once
from the browser, once from your server — and Meta deduplicates them
into a single event using a shared `event_id`.

## ⚠️ Important: rotate your access token first

An access token was shared in plain text during this conversation. It
was **never** written into any file — `meta-capi.js` only reads it from
the `META_ACCESS_TOKEN` environment variable — but since the token was
exposed in chat, you should treat it as compromised:

1. Go to Meta Events Manager → your dataset → Settings → Conversions API
2. Generate a **new** access token
3. Revoke/delete the old one
4. Use the new token in step 2 below

## 1. Add environment variables in Netlify

Netlify → your site → **Site configuration → Environment variables → Add a variable**

| Variable name | Value |
|---|---|
| `META_PIXEL_ID` | `1011003394626105` |
| `META_ACCESS_TOKEN` | your new Conversions API access token from Events Manager |

These are separate from `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, etc. —
nothing about those existing variables changes.

## 2. Redeploy

Trigger a new deploy in Netlify so the function picks up the new
environment variables.

## What changed, file by file

### New file
- **`netlify/functions/meta-capi.js`** — accepts an event name, a shared
  `event_id`, custom event data (same shape as the existing `fbq()`
  calls), and optional hashed customer data, then forwards it to
  `graph.facebook.com/.../events`. Hashes all PII (email, phone, name,
  country, external_id) server-side with SHA-256 per Meta's spec before
  sending anything. Never logs the access token or raw PII.

### Every HTML page
Each page now has a small shared `pmMetaCapi` helper script (right after
the existing Pixel `<script>` block) that:
- Generates one `event_id` per event
- Calls `fbq('track', EventName, data, { eventID })` — the *existing*
  fbq() event, now just carrying a dedup ID
- Sends the same event_id + data + `_fbp`/`_fbc` cookies to
  `meta-capi.js` in parallel

No existing `fbq()` event was removed. `PageView` and (on the product
pages) `ViewContent` fire immediately on page load, same as before, just
with an `eventID` now attached and a mirrored server call alongside.

### `index.html`, `bogo-7-reasons-most-himalayan-shilajit-is-fake.html`, `hidden-truth-about-ashwagandha.html`, `bundles.html`
`AddToCart` and `InitiateCheckout` calls were switched from direct
`fbq('track', ...)` calls to `pmMetaCapi.track(...)`, which fires both
the browser and server event with the same id. The event data passed in
is identical to before — only the dispatch mechanism changed.

### `checkout.html`
- Added the `pmMetaCapi` helper and `PageView` mirroring.
- `trackPurchase()` (used in the PayPal flow) now sends hashed customer
  data — email, first/last name, country — pulled from the existing
  delivery form fields, plus a per-browser `external_id` stored in
  `localStorage`. No phone field exists in the current checkout form, so
  `phone` is omitted (the function already skips any field that isn't
  provided rather than sending an empty hash).
- The PayPal-side Purchase-dedup logic (only firing once, right before
  redirecting to `success.html`) is unchanged.

### `success.html`
- Added the `pmMetaCapi` helper and `PageView` mirroring.
- The existing Stripe-Purchase dedup logic (a `sessionStorage` flag
  keyed by the Stripe `session_id`, so a page refresh never double-fires
  Purchase) is **unchanged** — only extended to also mirror the same
  event to the server. The `event_id` used is deterministically derived
  from the Stripe `session_id` (`'stripe-purchase-' + sessionId`), so
  browser and server events share one id without needing to pass it
  through Stripe's hosted checkout page (which isn't possible without
  modifying `create-checkout.js`, which was off-limits per your
  instructions).
- Email/name aren't available on this page for Stripe orders, since
  Stripe collects that information on its own hosted page rather than
  ours — only `fbp`/`fbc` cookies and the `external_id` set during
  checkout are sent as matching signals for the server-side Purchase
  event.

### `cancel.html`, `ueber-uns.html`, `impressum-agb.html`, `versand-transparenz.html`, `widerrufsrecht.html`
Added the `pmMetaCapi` helper and `PageView` mirroring only — these
pages have no cart/checkout events to extend.

## What did NOT change

- `netlify/functions/create-checkout.js`, `create-payment-intent.js`,
  `paypal-capture-order.js`, `paypal-create-order.js`,
  `send-verification-code.js`, `stripe-webhook.js`, `verify-code.js`,
  `_mailer.js`, `_catalog.js` — byte-for-byte identical to before.
- No existing `fbq()` event, content_id, product price, or cart/checkout
  logic was altered.
- The discount-popup Advanced Matching calls (`fbq('init', ..., { em })`)
  added earlier remain exactly as they were.

## A known limitation worth knowing about

Meta's Conversions API technically supports sending `phone` as a
matching signal, but the checkout form on this site doesn't currently
collect a phone number, so that field is simply omitted from every CAPI
call. If you'd like a phone field added to checkout for stronger Advanced
Matching, that's a separate, deliberate change to the checkout form —
let me know if you want it.
