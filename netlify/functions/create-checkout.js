// netlify/functions/create-checkout.js
//
// Creates a Stripe Checkout Session and returns the URL to redirect to.
// Stripe Checkout automatically shows Apple Pay / Google Pay wallet
// buttons when the shopper's browser/device supports them — no extra
// code needed for that part.
//
// Now accepts a cart of multiple line items (main product + upsell
// bundles) instead of a single quantity. Prices are always resolved
// server-side from _catalog.js — never trust client-supplied prices.
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
          images: [
            `${origin}/images/mountaindrop-original-shilajit-himalayas-100g-mountaindrop.com.png`,
          ],
        },
      },
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      shipping_address_collection: {
        allowed_countries: ["DE", "AT", "CH", "FR", "BE", "NL", "LU", "ES", "IT", "PT"],
      },
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

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
