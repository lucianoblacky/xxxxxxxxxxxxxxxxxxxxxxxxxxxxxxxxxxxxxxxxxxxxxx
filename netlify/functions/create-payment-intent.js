// netlify/functions/create-payment-intent.js
//
// Creates a Stripe PaymentIntent for an embedded (Stripe Elements)
// checkout — the card form lives directly on checkout.html, so the
// shopper never leaves the page. This replaces the old
// create-checkout.js (Stripe Checkout Session / redirect flow).
//
// Prices are always resolved server-side from _catalog.js — never
// trust client-supplied prices.
//
// Required environment variable (set in Netlify dashboard):
//   STRIPE_SECRET_KEY

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { resolveLineItems } = require("./_catalog");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Stripe is not configured. Missing STRIPE_SECRET_KEY.",
      }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    let totalEUR, lineItems;
    try {
      const resolved = resolveLineItems(body.items);
      lineItems = resolved.lineItems;
      totalEUR = resolved.totalEUR;
    } catch (validationErr) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: validationErr.message }),
      };
    }

    const shipping = body.shipping || {};
    const amountCents = Math.round(totalEUR * 100);

    const paymentIntentParams = {
      amount: amountCents,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      description: lineItems
        .map((item) => `${item.name} x${item.quantity}`)
        .join(", ")
        .slice(0, 500),
      metadata: {
        items: JSON.stringify(
          lineItems.map((i) => ({ id: i.id, qty: i.quantity }))
        ).slice(0, 500),
      },
    };

    // Attach shipping details if provided so the merchant has them on the
    // PaymentIntent / in the Stripe Dashboard, without asking the shopper
    // for the address a second time anywhere else.
    if (shipping.name && shipping.address && shipping.city) {
      paymentIntentParams.shipping = {
        name: shipping.name,
        address: {
          line1: shipping.address,
          line2: shipping.address2 || undefined,
          city: shipping.city,
          postal_code: shipping.zip || undefined,
          country: shipping.countryCode || undefined,
        },
      };
    }
    if (shipping.email) {
      paymentIntentParams.receipt_email = shipping.email;
    }

    const paymentIntent = await stripe.paymentIntents.create(
      paymentIntentParams
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        amount: amountCents,
      }),
    };
  } catch (error) {
    console.error("Stripe PaymentIntent error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to start payment." }),
    };
  }
};
