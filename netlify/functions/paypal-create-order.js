// netlify/functions/paypal-create-order.js
//
// Creates a PayPal order via the REST Orders v2 API.
//
// The shopper's shipping address is collected once, in the Delivery
// form on checkout.html — we pass it to PayPal here as a fixed address
// (shipping_preference: SET_PROVIDED_ADDRESS) so PayPal's own popup
// does not ask for it again.
//
// Prices are always resolved server-side from _catalog.js — never
// trust client-supplied prices.
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

    const shipping = body.shipping || {};
    const hasAddress = Boolean(shipping.name && shipping.address && shipping.city);

    const purchaseUnit = {
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
    };

    if (hasAddress) {
      purchaseUnit.shipping = {
        name: { full_name: shipping.name },
        address: {
          address_line_1: shipping.address,
          address_line_2: shipping.address2 || undefined,
          admin_area_2: shipping.city,
          postal_code: shipping.zip || undefined,
          country_code: shipping.countryCode || "DE",
        },
      };
    }

    const response = await fetch(`${getApiBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [purchaseUnit],
        application_context: {
          shipping_preference: hasAddress ? "SET_PROVIDED_ADDRESS" : "GET_FROM_FILE",
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
