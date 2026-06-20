// netlify/functions/paypal-capture-order.js
//
// Captures (finalizes) a previously created PayPal order once the
// shopper approves it in the PayPal popup.
//
// Required environment variables (set in Netlify dashboard):
//   PAYPAL_CLIENT_ID
//   PAYPAL_CLIENT_SECRET
//   PAYPAL_ENVIRONMENT

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
    const orderID = body.orderID;

    if (!orderID) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing orderID." }),
      };
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
      `${getApiBase()}/v2/checkout/orders/${orderID}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("PayPal capture error:", data);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Unable to capture PayPal order." }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: data.status, id: data.id }),
    };
  } catch (error) {
    console.error("PayPal capture-order error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to capture PayPal order." }),
    };
  }
};
