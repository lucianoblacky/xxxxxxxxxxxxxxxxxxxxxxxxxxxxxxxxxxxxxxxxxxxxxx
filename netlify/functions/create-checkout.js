// netlify/functions/create-checkout.js
//
// Creates a Stripe Checkout Session and returns the URL to redirect to.
// This is the REDIRECT model: the shopper leaves checkout.html and
// completes payment + shipping address entry on Stripe's own hosted
// page. Stripe Checkout automatically shows Apple Pay / Google Pay
// wallet buttons when the shopper's browser/device supports them —
// no extra code needed for that part.
//
// We collect a Delivery form on checkout.html for UX/branding reasons,
// but Stripe's own page still legally collects the binding shipping
// address. To avoid the shopper feeling like they're retyping
// everything, we forward their email so Stripe's page arrives
// pre-filled with it.
//
// Prices are always resolved server-side from _catalog.js — never
// trust client-supplied prices.
//
// Required environment variable (set in Netlify dashboard):
//   STRIPE_SECRET_KEY

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { resolveLineItems } = require("./_catalog");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    let lineItemsResolved;
    try {
      lineItemsResolved = resolveLineItems(body.items).lineItems;
    } catch (validationErr) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: validationErr.message }),
      };
    }

    const origin =
      event.headers.origin ||
      `https://${event.headers.host}` ||
      "http://localhost:8888";

    const stripeLineItems = lineItemsResolved.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "eur",
        unit_amount: Math.round(item.unitPrice * 100),
        product_data: {
          name: item.name,
        },
      },
    }));

    const shipping = body.shipping || {};
    const sessionParams = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      // Stripe still legally collects/confirms the shipping address on
      // its own page — but we pre-fill the email so the shopper doesn't
      // feel like they're starting over from scratch.
      shipping_address_collection: {
        allowed_countries: ["DE", "AT", "CH", "FR", "BE", "NL", "LU", "ES", "IT", "PT"],
      },
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    };

    if (shipping.email && EMAIL_RE.test(shipping.email)) {
      sessionParams.customer_email = shipping.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to create checkout session." }),
    };
  }
};
