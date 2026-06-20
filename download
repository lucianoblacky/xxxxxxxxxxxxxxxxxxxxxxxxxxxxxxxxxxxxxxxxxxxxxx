// netlify/functions/create-checkout.js
//
// Creates a Stripe Checkout Session and returns the URL to redirect to.
// Stripe Checkout automatically shows Apple Pay / Google Pay wallet
// buttons when the shopper's browser/device supports them — no extra
// code needed for that part.
//
// Required environment variable (set in Netlify dashboard):
//   STRIPE_SECRET_KEY

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const PRICE_EUR_CENTS = 9450; // 94.50 EUR — keep in sync with index.html
const COMPARE_AT_EUR_CENTS = 21000; // 210.00 EUR, shown struck-through
const PRODUCT_NAME = "Original Himalayan Shilajit (2x45g) - Buy One Get One Free";

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
    const quantity = Math.min(
      Math.max(parseInt(body.quantity, 10) || 1, 1),
      10
    );

    const origin =
      event.headers.origin ||
      `https://${event.headers.host}` ||
      "http://localhost:8888";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity,
          price_data: {
            currency: "eur",
            unit_amount: PRICE_EUR_CENTS,
            product_data: {
              name: PRODUCT_NAME,
              images: [`${origin}/images/mountaindrop-original-shilajit-himalayas-100g-mountaindrop.com.png`],
            },
          },
        },
      ],
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
