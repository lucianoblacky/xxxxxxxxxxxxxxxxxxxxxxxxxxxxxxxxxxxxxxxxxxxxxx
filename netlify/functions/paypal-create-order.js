// netlify/functions/paypal-create-order.js
//
// Creates a PayPal order via the REST Orders v2 API.
//
// Now accepts a cart of multiple line items (main product + upsell
// bundles) instead of a single quantity. Prices are always resolved
// server-side from _catalog.js — never trust client-supplied prices.
//
// Required environment variables (set in Netlify dashboard):
//   PAYPAL_CLIENT_ID
//   PAYPAL_CLIENT_SECRET
//   PAYPAL_ENVIRONMENT   ("sandbox" while testing, "live" once ready)

const { resolveLineItems } = require("./_catalog");

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

    let lineItems, totalEUR;
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

    const description = lineItems
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ")
      .slice(0, 127);

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
            description,
            amount: {
              currency_code: "EUR",
              value: totalEUR.toFixed(2),
              breakdown: {
                item_total: {
                  currency_code: "EUR",
                  value: totalEUR.toFixed(2),
                },
              },
            },
            items: lineItems.map((item) => ({
              name: item.name.slice(0, 127),
              unit_amount: {
                currency_code: "EUR",
                value: item.unitPrice.toFixed(2),
              },
              quantity: String(item.quantity),
              category: "PHYSICAL_GOODS",
            })),
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
