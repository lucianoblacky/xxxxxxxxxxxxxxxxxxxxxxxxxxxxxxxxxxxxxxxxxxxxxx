// netlify/functions/paypal-capture-order.js
//
// Captures (finalizes) a previously created PayPal order once the
// shopper approves it in the PayPal popup. On success, also sends an
// order notification email to the store owner.
//
// Required environment variables (set in Netlify dashboard):
//   PAYPAL_CLIENT_ID
//   PAYPAL_CLIENT_SECRET
//   PAYPAL_ENVIRONMENT
//   RESEND_API_KEY           — see _mailer.js
//   ORDER_NOTIFICATION_EMAIL — where order alerts are sent, e.g.
//                              anassasilem9@gmail.com

const { sendMail } = require("./_mailer");

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

    // Payment succeeded — notify the store owner. We never block the
    // shopper's success response on this; if the email fails, the
    // order is still valid and the shopper still sees their confirmation.
    //
    // This template intentionally mirrors stripe-webhook.js's order
    // notification email field-for-field (customer name, email,
    // shipping address, items, quantities, total, currency) so both
    // payment methods produce an identical-looking notification.
    try {
      const notifyTo = process.env.ORDER_NOTIFICATION_EMAIL;
      if (notifyTo) {
        const purchaseUnit = data.purchase_units?.[0];
        const capture = purchaseUnit?.payments?.captures?.[0];
        const amount = capture?.amount?.value || "unknown";
        const currency = capture?.amount?.currency_code || "EUR";
        const payerEmail = data.payer?.email_address || "Not provided";

        const payerName = data.payer?.name;
        const payerFullName = payerName
          ? `${payerName.given_name || ""} ${payerName.surname || ""}`.trim()
          : "";
        const shippingFullName = purchaseUnit?.shipping?.name?.full_name;
        const customerName = shippingFullName || payerFullName || "Not provided";

        const shippingAddr = purchaseUnit?.shipping?.address;
        const addressHtml = shippingAddr
          ? `${shippingAddr.address_line_1 || ""} ${shippingAddr.address_line_2 || ""}, ${shippingAddr.postal_code || ""} ${shippingAddr.admin_area_2 || ""}, ${shippingAddr.country_code || ""}`.replace(/\s+/g, " ").trim()
          : "Not provided";

        const itemsHtml = (purchaseUnit?.items || [])
          .map((it) => `<li>${it.quantity} × ${it.name}</li>`)
          .join("");

        await sendMail({
          to: notifyTo,
          subject: `New order — ${amount} ${currency} (PayPal)`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
              <h2>New order received (PayPal)</h2>
              <p><strong>Customer name:</strong> ${customerName}</p>
              <p><strong>Customer email:</strong> ${payerEmail}</p>
              <p><strong>Shipping address:</strong> ${addressHtml}</p>
              <p><strong>Items:</strong></p>
              <ul>${itemsHtml}</ul>
              <p><strong>Total:</strong> ${amount} ${currency}</p>
              <p style="color:#999;font-size:12px;">PayPal order: ${orderID}</p>
            </div>
          `,
        });
      }
    } catch (mailError) {
      console.error("Failed to send PayPal order notification email:", mailError.message);
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
