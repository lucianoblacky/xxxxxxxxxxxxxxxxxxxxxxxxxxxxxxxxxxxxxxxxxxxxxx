# PeakModo BOGO Landing Page — Setup

One HTML page + 3 tiny Netlify Functions for Stripe and PayPal checkout.
No Next.js, no build step for the page itself — just upload and deploy.

---

## What you need to do (4 keys total)

### 1. PayPal Client ID — goes directly in `index.html`

Open `index.html`, near the top (inside `<head>`), find this line:

```html
<script src="https://www.paypal.com/sdk/js?client-id=ATdpIv0p_QiZrdxq9FnwU4rPithjiIB9Wr25h4GyfakNRB_NNDI5FScWm4EYiNPbuqj_WXVwHYd8RnQ_&currency=EUR&intent=capture"></script>
```

Replace `YOUR_PAYPAL_CLIENT_ID_HERE` with your real PayPal Client ID.
Get it from: https://developer.paypal.com/dashboard/applications
→ Apps & Credentials → your app → **Client ID**.

This ID is meant to be public (PayPal's own checkout script requires it
in the page source), so it's fine that it's visible in the HTML.

### 2–4. The other 3 keys — go into Netlify environment variables (NOT in any file)

These stay secret, so they are never written into any file you upload —
you add them once in the Netlify dashboard:

**Netlify → Site configuration → Environment variables → Add a variable**

| Variable name | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/apikeys → Developers → API keys → **Secret key** (starts with `sk_test_` or `sk_live_`) |
| `PAYPAL_CLIENT_ID` | Same PayPal app as step 1 → **Client ID** (same value you put in index.html) |
| `PAYPAL_CLIENT_SECRET` | Same PayPal app → **Secret** |
| `PAYPAL_ENVIRONMENT` | `sandbox` while testing, `live` once you're ready for real payments |

That's it — 1 ID in the HTML file, 4 values in Netlify's dashboard
(PAYPAL_CLIENT_ID is added in both places because Stripe/PayPal split
public vs. secret usage differently).

---

## How to deploy

### Option A — Netlify UI (drag and drop, easiest)

1. Edit `index.html` and paste your PayPal Client ID (step 1 above).
2. Go to https://app.netlify.com/drop
3. Drag this whole folder onto the page.
4. Once the site is created, go to **Site configuration → Environment
   variables** and add the 4 variables from the table above.
5. Go to **Deploys** and trigger **Deploy site** again (so the functions
   pick up the new environment variables).

### Option B — Git + Netlify (recommended for ongoing updates)

```bash
git init
git add .
git commit -m "BOGO landing page with Stripe + PayPal"
git remote add origin https://github.com/your-username/your-repo.git
git push -u origin main
```

Then in Netlify: **Add new site → Import an existing project** → pick
your repo. Netlify reads `netlify.toml` automatically (publish folder is
`.`, functions folder is `netlify/functions`). Add the 4 environment
variables as in Option A, step 4.

### Option C — Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set STRIPE_SECRET_KEY sk_test_xxxxxxxxxxxxxxxxxxxxxxxx
netlify env:set PAYPAL_CLIENT_ID your-paypal-client-id
netlify env:set PAYPAL_CLIENT_SECRET your-paypal-client-secret
netlify env:set PAYPAL_ENVIRONMENT sandbox
netlify deploy --prod
```

---

## Testing before going live

1. Use Stripe **test** keys (`sk_test_...`) and click "Pay with Card /
   Apple Pay / Google Pay" — Stripe's hosted checkout page opens. Use
   [Stripe's test card numbers](https://docs.stripe.com/testing) (e.g.
   `4242 4242 4242 4242`, any future expiry, any CVC).
2. Set `PAYPAL_ENVIRONMENT=sandbox` and use a PayPal **sandbox** app —
   create a sandbox buyer account at
   https://developer.paypal.com/dashboard/accounts to test a full
   purchase without moving real money.
3. Once both work end-to-end, switch:
   - Stripe keys to `sk_live_...` (and the PayPal app to your live app)
   - `PAYPAL_ENVIRONMENT` to `live`
   - Update the PayPal Client ID in `index.html` to the live one too, if
     it's different from your sandbox app.

---

## Updating the price

The price (94.50 EUR, compare-at 210.00 EUR) appears in **3 places** —
keep them in sync if you change it:

1. `index.html` — `const UNIT_PRICE` and `const UNIT_COMPARE_PRICE` (near
   the bottom, inside the `<script>` tag)
2. `netlify/functions/create-checkout.js` — `PRICE_EUR_CENTS`
3. `netlify/functions/paypal-create-order.js` — `PRICE_EUR`

---

## File structure

```
index.html                              ← the landing page itself
success.html                            ← shown after a successful payment
cancel.html                             ← shown if checkout is cancelled
images/                                 ← all images, hosted locally
netlify.toml                            ← tells Netlify where functions live
package.json                            ← the "stripe" npm package the function needs
netlify/functions/
  create-checkout.js                    ← creates the Stripe Checkout Session
  paypal-create-order.js                ← creates a PayPal order
  paypal-capture-order.js               ← captures (finalizes) a PayPal order
```

## Updating the footer address / support email

Search for "Our Address" and "support@" near the bottom of `index.html`
and replace with your real business details before going live.
