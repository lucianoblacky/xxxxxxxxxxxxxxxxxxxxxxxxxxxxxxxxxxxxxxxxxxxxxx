// netlify/functions/send-verification-code.js
//
// Generates a real 6-digit verification code, emails it to the address
// the shopper entered, and returns a signed token representing that
// code. The token is NOT the code itself — it's an HMAC-signed package
// containing a hash of the code, the email, and an expiry timestamp.
// The browser holds onto this token and sends it back along with the
// code the shopper types in, so verify-code.js can confirm a match
// without needing a database.
//
// Required environment variables (set in Netlify dashboard):
//   RESEND_API_KEY      — see _mailer.js
//   VERIFY_CODE_SECRET   — any long random string, used to sign tokens
//                          so they can't be forged or read by the client.
//                          Generate one with: openssl rand -hex 32

const crypto = require("crypto");
const { sendMail } = require("./_mailer");

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secret = process.env.VERIFY_CODE_SECRET;
  if (!secret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is not configured (missing VERIFY_CODE_SECRET)." }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const email = (body.email || "").trim().toLowerCase();

    if (!email || !EMAIL_RE.test(email)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Please enter a valid email address." }),
      };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 100000–999999
    const expiresAt = Date.now() + CODE_TTL_MS;

    // The token packages everything verify-code.js needs to check the
    // code later, without storing anything server-side: the email it
    // was sent to, the expiry time, and a hash of the code itself
    // (never the raw code — so the token alone can't be used to derive it).
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const payload = `${email}:${codeHash}:${expiresAt}`;
    const signature = sign(payload, secret);
    const token = Buffer.from(`${payload}:${signature}`).toString("base64url");

    await sendMail({
      to: email,
      subject: "Your PeakModo discount code",
      html: `
        <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;">
          <h2 style="margin:0 0 8px;">Your verification code</h2>
          <p style="color:#555;margin:0 0 20px;">Enter this code on the PeakModo website to unlock your 15% discount.</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:0.15em;background:#f4f2ed;padding:16px;text-align:center;border-radius:8px;color:#1c1c1c;">${code}</div>
          <p style="color:#999;font-size:13px;margin-top:20px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ token }),
    };
  } catch (error) {
    console.error("send-verification-code error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to send verification code right now." }),
    };
  }
};
