// netlify/functions/paypal-create-order.js
//
// Creates a PayPal order via the REST Orders v2 API.
//
// Required environment variables (set in Netlify dashboard):
//   PAYPAL_CLIENT_ID
//   PAYPAL_CLIENT_SECRET
//   PAYPAL_ENVIRONMENT   ("sandbox" while testing, "live" once ready)

const PRICE_EUR = 94.5; // keep in sync with index.html and create-checkout.js
const PRODUCT_NAME = "Original Himalayan Shilajit (2x45g) - Buy One Get One Free";

function getApiBase() {
  return process.env.PAYPAL_ENVIRONMENT === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET.");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${getApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayPal auth failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const quantity = Math.min(
      Math.max(parseInt(body.quantity, 10) || 1, 1),
      10
    );
    const totalValue = (PRICE_EUR * quantity).toFixed(2);

    const accessToken = await getAccessToken();

    const response = await fetch(`${getApiBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: PRODUCT_NAME.slice(0, 127),
            amount: {
              currency_code: "EUR",
              value: totalValue,
            },
          },
        ],
        application_context: {
          shipping_preference: "GET_FROM_FILE",
          user_action: "PAY_NOW",
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("PayPal create order error:", data);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Unable to create PayPal order." }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ id: data.id }),
    };
  } catch (error) {
    console.error("PayPal create-order error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to create PayPal order." }),
    };
  }
};
