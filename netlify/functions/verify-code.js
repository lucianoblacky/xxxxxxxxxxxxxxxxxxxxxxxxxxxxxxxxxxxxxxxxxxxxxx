// netlify/functions/verify-code.js
//
// Verifies a code the shopper typed in against the signed token issued
// by send-verification-code.js. No database needed: the token already
// contains everything required to check the code (a hash of it, the
// email it was sent to, and an expiry time), all tamper-proofed with
// an HMAC signature using VERIFY_CODE_SECRET.
//
// Required environment variable (set in Netlify dashboard):
//   VERIFY_CODE_SECRET   — must be the exact same value used by
//                          send-verification-code.js

const crypto = require("crypto");

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
    const code = String(body.code || "").trim();
    const token = String(body.token || "").trim();

    if (!code || !token) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing code or token." }),
      };
    }

    let decoded;
    try {
      decoded = Buffer.from(token, "base64url").toString("utf8");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid token." }) };
    }

    const parts = decoded.split(":");
    if (parts.length !== 4) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid token." }) };
    }
    const [email, codeHash, expiresAtStr, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    const expectedSignature = sign(`${email}:${codeHash}:${expiresAtStr}`, secret);
    if (signature !== expectedSignature) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid or tampered token." }) };
    }

    if (Date.now() > expiresAt) {
      return { statusCode: 400, body: JSON.stringify({ error: "This code has expired. Please request a new one." }) };
    }

    const candidateHash = crypto.createHash("sha256").update(code).digest("hex");
    if (candidateHash !== codeHash) {
      return { statusCode: 400, body: JSON.stringify({ error: "Incorrect code. Please try again." }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ verified: true, email }),
    };
  } catch (error) {
    console.error("verify-code error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to verify code right now." }),
    };
  }
};
