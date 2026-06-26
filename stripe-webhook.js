// netlify/functions/stripe-webhook.js
//
// Listens for Stripe's `payment_intent.succeeded` event and sends an
// order notification email to the store owner. This is the reliable
// way to know a Stripe payment actually succeeded — unlike trusting
// anything the browser tells checkout.html, this endpoint is called
// directly by Stripe's servers and the signature is verified, so it
// can't be faked.
//
// This listens for payment_intent.succeeded rather than
// checkout.session.completed because the checkout flow now uses
// Stripe Elements (an embedded PaymentIntent on checkout.html) instead
// of a redirect to Stripe's hosted Checkout Session page.
//
// SETUP REQUIRED in the Stripe Dashboard:
//   1. Go to Developers → Webhooks → Add endpoint
//   2. Endpoint URL: https://YOUR-DOMAIN/.netlify/functions/stripe-webhook
//   3. Select event: payment_intent.succeeded
//   4. Copy the "Signing secret" (starts with whsec_...) into Netlify
//      as the STRIPE_WEBHOOK_SECRET environment variable.
//
//   If you previously had this webhook configured for
//   checkout.session.completed, update the selected event in the
//   Stripe Dashboard to payment_intent.succeeded — the signing secret
//   stays the same.
//
// Required environment variables (set in Netlify dashboard):
//   STRIPE_SECRET_KEY        — same key used by create-payment-intent.js
//   STRIPE_WEBHOOK_SECRET    — from the Stripe webhook setup above
//   RESEND_API_KEY           — see _mailer.js
//   ORDER_NOTIFICATION_EMAIL — where order alerts are sent, e.g.
//                              anassasilem9@gmail.com

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendMail } = require("./_mailer");
const { CATALOG } = require("./_catalog");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET.");
    return { statusCode: 500, body: "Webhook not configured." };
  }

  let stripeEvent;
  try {
    const signature = event.headers["stripe-signature"];
    stripeEvent = stripe.webhooks.constructEvent(event.body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error.message);
    return { statusCode: 400, body: `Webhook signature verification failed.` };
  }

  if (stripeEvent.type === "payment_intent.succeeded") {
    const paymentIntent = stripeEvent.data.object;

    try {
      // --------------------------------------------------------------
      // IDEMPOTENCY CHECK
      //
      // Stripe does not guarantee exactly-once webhook delivery — the
      // same payment_intent.succeeded event can be redelivered (e.g.
      // after a slow response, a transient network error, or Stripe's
      // own retry policy). We use the PaymentIntent's own metadata as
      // a durable flag: before sending the order email, re-fetch the
      // PaymentIntent fresh from Stripe (not the possibly-stale event
      // payload) and check whether we've already marked it as
      // notified. If so, skip sending entirely — this guarantees the
      // order notification email is sent exactly once per
      // PaymentIntent, no matter how many times Stripe redelivers
      // this event.
      // --------------------------------------------------------------
      const freshIntent = await stripe.paymentIntents.retrieve(paymentIntent.id);

      if (freshIntent.metadata?.order_email_sent === "1") {
        return { statusCode: 200, body: JSON.stringify({ received: true, alreadyProcessed: true }) };
      }

      // Re-derive the purchased items from our own catalog using the
      // ids/quantities we stored in metadata when the PaymentIntent was
      // created — never trust amounts from the client, only the
      // metadata we ourselves wrote server-side in create-payment-intent.js.
      let items = [];
      try {
        items = JSON.parse(freshIntent.metadata?.items || "[]");
      } catch (parseErr) {
        items = [];
      }

      const itemsHtml = items
        .map((it) => {
          const catalogEntry = CATALOG[it.id];
          const name = catalogEntry ? catalogEntry.name : it.id;
          return `<li>${it.qty} × ${name}</li>`;
        })
        .join("");

      const totalEUR = (freshIntent.amount / 100).toFixed(2);
      const customerEmail = freshIntent.receipt_email || "Not provided";
      const shippingAddr = freshIntent.shipping?.address;
      const addressHtml = shippingAddr
        ? `${shippingAddr.line1 || ""} ${shippingAddr.line2 || ""}, ${shippingAddr.postal_code || ""} ${shippingAddr.city || ""}, ${shippingAddr.country || ""}`.replace(/\s+/g, " ").trim()
        : "Not provided";
      const customerName = freshIntent.shipping?.name || "Not provided";

      const notifyTo = process.env.ORDER_NOTIFICATION_EMAIL;
      if (notifyTo) {
        // Same template structure/field order as paypal-capture-order.js
        // — both payment methods must produce an identical-looking
        // order notification email.
        await sendMail({
          to: notifyTo,
          subject: `New order — ${totalEUR} EUR (Stripe)`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
              <h2>New order received (Stripe)</h2>
              <p><strong>Customer name:</strong> ${customerName}</p>
              <p><strong>Customer email:</strong> ${customerEmail}</p>
              <p><strong>Shipping address:</strong> ${addressHtml}</p>
              <p><strong>Items:</strong></p>
              <ul>${itemsHtml}</ul>
              <p><strong>Total:</strong> ${totalEUR} EUR</p>
              <p style="color:#999;font-size:12px;">Stripe PaymentIntent: ${freshIntent.id}</p>
            </div>
          `,
        });
      }

      // Mark this PaymentIntent as notified BEFORE returning, so any
      // redelivery of this same event — even one already in flight
      // concurrently — sees the flag set and skips re-sending. This
      // write happens after the email send succeeds, so a failed send
      // is naturally retried on the next webhook delivery rather than
      // being incorrectly marked as done.
      await stripe.paymentIntents.update(freshIntent.id, {
        metadata: { ...freshIntent.metadata, order_email_sent: "1" },
      });
    } catch (error) {
      // We still return 200 to Stripe even if our notification email
      // fails — the payment itself already succeeded, and Stripe will
      // retry the webhook on a non-2xx response, which we don't want
      // here since the order is already valid either way. Since the
      // metadata flag is only set AFTER a successful send, a failed
      // attempt here will correctly retry sending (not skip it) on the
      // next webhook delivery.
      console.error("Failed to send order notification email:", error.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
