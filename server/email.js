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
async function sendEmail(to, subject, html, text) {
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
        text,
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

// Shared branded wrapper so every transactional email looks consistent.
// Deliberately a light background, not the app's dark theme — full-page
// dark backgrounds render badly (or get stripped) in several email clients
// (Outlook desktop in particular), so transactional mail uses light chrome
// with the brand's cyan/fuchsia as accent color instead.
function renderEmailShell(bodyHtml) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; padding: 32px 16px;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 16px rgba(2, 6, 23, 0.08);">
        <div style="background: linear-gradient(135deg, #22d3ee, #d946ef); padding: 24px 32px;">
          <span style="color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 2px;">TRINKDUELL</span>
        </div>
        <div style="padding: 32px;">
          ${bodyHtml}
        </div>
        <div style="padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0; color: #94a3b8; font-size: 11px; line-height: 1.5;">
            Diese E-Mail wurde automatisch von TrinkDuell verschickt. Falls du diese Aktion nicht selbst
            ausgelöst hast, kannst du sie einfach ignorieren — es passiert nichts weiter.
          </p>
        </div>
      </div>
    </div>`;
}

async function sendPasswordResetEmail(to, code) {
  const html = renderEmailShell(`
    <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 20px;">Passwort zurücksetzen</h2>
    <p style="margin: 0 0 20px; color: #475569; font-size: 14px; line-height: 1.6;">
      Trage diesen Code in der App ein, um ein neues Passwort zu setzen:
    </p>
    <div style="background: #f1f5f9; border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 20px;">
      <span style="font-size: 36px; font-weight: 900; letter-spacing: 10px; color: #0f172a;">${code}</span>
    </div>
    <p style="margin: 0; color: #94a3b8; font-size: 13px;">Der Code ist 15 Minuten gültig.</p>
  `);

  const text = `Passwort zurücksetzen\n\nDein Reset-Code: ${code}\n\nTrage diesen Code in der App ein, um ein neues Passwort zu setzen. Der Code ist 15 Minuten gültig.\n\nFalls du das nicht warst, ignoriere diese E-Mail.`;

  return sendEmail(to, "Dein TrinkDuell Reset-Code", html, text);
}

module.exports = { isEmailConfigured, sendEmail, sendPasswordResetEmail };
