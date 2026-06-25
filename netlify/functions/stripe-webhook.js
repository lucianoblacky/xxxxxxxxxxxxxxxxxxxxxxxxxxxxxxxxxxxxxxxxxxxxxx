// netlify/functions/stripe-webhook.js
//
// Listens for Stripe's `checkout.session.completed` event and sends an
// order notification email to the store owner. This is the reliable
// way to know a Stripe payment actually succeeded — unlike success.html,
// which a shopper's browser could reach without ever paying, this
// endpoint is called directly by Stripe's servers and the signature is
// verified, so it can't be faked.
//
// SETUP REQUIRED in the Stripe Dashboard:
//   1. Go to Developers → Webhooks → Add endpoint
//   2. Endpoint URL: https://YOUR-DOMAIN/.netlify/functions/stripe-webhook
//   3. Select event: checkout.session.completed
//   4. Copy the "Signing secret" (starts with whsec_...) into Netlify
//      as the STRIPE_WEBHOOK_SECRET environment variable.
//
// Required environment variables (set in Netlify dashboard):
//   STRIPE_SECRET_KEY        — same key used by create-checkout.js
//   STRIPE_WEBHOOK_SECRET    — from the Stripe webhook setup above
//   RESEND_API_KEY           — see _mailer.js
//   ORDER_NOTIFICATION_EMAIL — where order alerts are sent, e.g.
//                              anassasilem9@gmail.com

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendMail } = require("./_mailer");

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

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;

    try {
      // Pull the actual purchased line items from Stripe directly,
      // rather than trusting anything the browser sent us.
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

      const itemsHtml = lineItems.data
        .map((li) => `<li>${li.quantity} × ${li.description} — €${(li.amount_total / 100).toFixed(2)}</li>`)
        .join("");

      const totalEUR = (session.amount_total / 100).toFixed(2);
      const customerEmail = session.customer_details?.email || session.customer_email || "unknown";
      const shippingAddr = session.customer_details?.address;
      const addressHtml = shippingAddr
        ? `${shippingAddr.line1 || ""} ${shippingAddr.line2 || ""}, ${shippingAddr.postal_code || ""} ${shippingAddr.city || ""}, ${shippingAddr.country || ""}`
        : "Not provided";

      const notifyTo = process.env.ORDER_NOTIFICATION_EMAIL;
      if (notifyTo) {
        await sendMail({
          to: notifyTo,
          subject: `New order — €${totalEUR} (Stripe)`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
              <h2>New order received (Stripe)</h2>
              <p><strong>Customer:</strong> ${customerEmail}</p>
              <p><strong>Shipping address:</strong> ${addressHtml}</p>
              <p><strong>Items:</strong></p>
              <ul>${itemsHtml}</ul>
              <p><strong>Total:</strong> €${totalEUR}</p>
              <p style="color:#999;font-size:12px;">Stripe session: ${session.id}</p>
            </div>
          `,
        });
      }
    } catch (error) {
      // We still return 200 to Stripe even if our notification email
      // fails — the payment itself already succeeded, and Stripe will
      // retry the webhook on a non-2xx response, which we don't want
      // here since the order is already valid either way.
      console.error("Failed to send order notification email:", error);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
