// netlify/functions/_mailer.js
//
// Shared helper for sending email via Resend (https://resend.com).
//
// Required environment variable (set in Netlify dashboard):
//   RESEND_API_KEY
//
// Optional environment variable:
//   RESEND_FROM_EMAIL
//     The "from" address used for all outgoing mail. Until your domain
//     is verified on Resend, you MUST use "onboarding@resend.dev" here
//     (or leave it unset — that's the default). Once your domain
//     (e.g. peakmodo.com) is verified in the Resend dashboard, change
//     this to something like "PeakModo <no-reply@peakmodo.com>".

const RESEND_API_URL = "https://api.resend.com/emails";

async function sendMail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY environment variable.");
  }

  const from = process.env.RESEND_FROM_EMAIL || "PeakModo <onboarding@resend.dev>";

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Resend API error:", response.status, data);
    throw new Error(data.message || "Failed to send email via Resend.");
  }

  return data;
}

module.exports = { sendMail };
