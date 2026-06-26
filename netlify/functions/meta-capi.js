// netlify/functions/meta-capi.js
//
// Forwards a single Meta (Facebook) Pixel event to the Conversions API
// (server-side), so every browser-side fbq() call has a matching
// server-side event. Meta deduplicates the two using the same
// `event_id` on both sides — the browser pixel call must pass the
// identical event_id via fbq('track', 'EventName', data, { eventID }).
//
// This function is generic: it accepts the event name + the same data
// shape already used in the existing fbq() calls throughout the site,
// plus optional customer data and browser identifiers, and translates
// them into the shape the Conversions API expects.
//
// Required environment variables (set in Netlify dashboard):
//   META_PIXEL_ID       — the Pixel ID, e.g. 1011003394626105
//   META_ACCESS_TOKEN    — a System User access token with
//                          ads_management or business_management
//                          permission, generated in Events Manager →
//                          Settings → Conversions API. NEVER commit
//                          this value anywhere — it lives only as a
//                          Netlify environment variable.
//
// IMPORTANT: this function never logs the raw access token or raw
// (un-hashed) customer PII. Hashing of email/phone/name/etc. happens
// here, server-side, using SHA-256 exactly as Meta's spec requires —
// the browser only ever sends plain text over HTTPS to this endpoint,
// never directly to Meta.

const crypto = require("crypto");

const META_GRAPH_VERSION = "v21.0";

// ----------------------------------------------------------------------
// Meta requires PII fields to be normalized then SHA-256 hashed before
// they're sent. Normalization rules per Meta's spec:
//   - trim whitespace
//   - lowercase
//   - phone numbers: digits only, with country code, no leading +/0s
//     stripped by the caller; we just strip non-digits here
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
// ----------------------------------------------------------------------
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashField(value, { digitsOnly = false } = {}) {
  if (value === undefined || value === null) return undefined;
  let normalized = String(value).trim().toLowerCase();
  if (digitsOnly) {
    normalized = normalized.replace(/[^\d]/g, "");
  }
  if (!normalized) return undefined;
  return sha256(normalized);
}

// Builds the `user_data` object for a CAPI event: fbp/fbc are sent as
// plain text (Meta does not want these hashed), everything else (PII)
// is hashed. Any field not provided by the caller is simply omitted —
// Meta only requires that *some* matching signal is present, not all.
function buildUserData({ email, phone, firstName, lastName, country, externalId, fbp, fbc, clientIp, userAgent }) {
  const userData = {};

  const em = hashField(email);
  if (em) userData.em = [em];

  const ph = hashField(phone, { digitsOnly: true });
  if (ph) userData.ph = [ph];

  const fn = hashField(firstName);
  if (fn) userData.fn = [fn];

  const ln = hashField(lastName);
  if (ln) userData.ln = [ln];

  const country_hashed = hashField(country);
  if (country_hashed) userData.country = [country_hashed];

  const ext = hashField(externalId);
  if (ext) userData.external_id = [ext];

  // fbp / fbc are Meta's own browser/click identifiers — sent as-is,
  // never hashed, exactly as read from the _fbp / _fbc cookies.
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;

  return userData;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    console.error("Missing META_PIXEL_ID or META_ACCESS_TOKEN environment variable.");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Conversions API is not configured." }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const {
      eventName,        // e.g. 'PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'
      eventId,          // same event_id the browser passed to fbq(), for deduplication
      eventSourceUrl,   // the page URL the event happened on
      customData = {},  // content_ids, content_type, value, currency, num_items, etc. — same shape as the fbq() calls
      userData = {},    // { email, phone, firstName, lastName, country, externalId, fbp, fbc }
    } = body;

    if (!eventName || !eventId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required eventName or eventId." }),
      };
    }

    // Prefer the real client IP/user-agent from the request itself over
    // anything the browser claims, where available.
    const clientIp =
      event.headers["x-nf-client-connection-ip"] ||
      (event.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      undefined;
    const userAgent = event.headers["user-agent"] || undefined;

    const fbEvent = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      event_source_url: eventSourceUrl || undefined,
      user_data: buildUserData({ ...userData, clientIp, userAgent }),
      custom_data: customData,
    };

    const payload = {
      data: [fbEvent],
      // access_token is sent as a query parameter below, not in the
      // body, per Meta's API — kept here only as a comment for clarity.
    };

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      // Never log the access token or raw payload PII — just the
      // response Meta gave us, which is already error-shaped JSON.
      console.error("Meta CAPI error:", data);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Meta Conversions API rejected the event." }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, fbtrace_id: data.fbtrace_id }),
    };
  } catch (error) {
    console.error("meta-capi error:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to send event to Meta Conversions API." }),
    };
  }
};
