const RESEND_API_URL = "https://api.resend.com/emails";

// Optional: real email delivery via Resend, activated purely by setting
// RESEND_API_KEY in the environment — no code change needed. Until then,
// callers fall back to whatever behavior they had before (e.g. showing the
// reset code directly in the app), which is what the friends-only beta uses.
function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

// Returns true if the email was actually sent, false otherwise (including
// "not configured") — callers use this to decide whether it's still safe to
// hand the raw code back to the client.
async function sendEmail(to, subject, html) {
  if (!isEmailConfigured()) return false;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "TrinkDuell <onboarding@resend.dev>",
        to,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[Email] Resend responded ${res.status} for ${to}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[Email] Failed to send to ${to}:`, err.message);
    return false;
  }
}

async function sendPasswordResetEmail(to, code) {
  return sendEmail(
    to,
    "Dein TrinkDuell Reset-Code",
    `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Passwort zurücksetzen</h2>
      <p>Dein Reset-Code lautet:</p>
      <p style="font-size: 32px; font-weight: 900; letter-spacing: 8px;">${code}</p>
      <p>Der Code ist 15 Minuten gültig. Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>
    </div>`
  );
}

module.exports = { isEmailConfigured, sendEmail, sendPasswordResetEmail };
