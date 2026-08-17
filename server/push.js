const db = require("./db");

// Überschreibbar, damit die Testsuite den Versand gegen einen lokalen
// Auffangserver prüfen kann. Ohne diese Möglichkeit war die gesamte
// Push-Logik — wer benachrichtigt wird und wer nicht — nur auf echter
// Hardware beobachtbar, also praktisch ungetestet.
const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || "https://exp.host/--/api/v2/push/send";

// Sends a push notification to a user's registered device via Expo's push
// service. Uses Node's built-in fetch (Node 18+) instead of adding
// expo-server-sdk as a dependency for what is otherwise a single POST call.
// Never throws — a failed/missing push token must never break the request
// (e.g. creating a duel) that triggered the notification.
async function sendPushNotification(userId, title, body, data = {}) {
  try {
    const token = await db.getPushToken(userId);
    if (!token) return;

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data,
        sound: "default",
      }),
    });

    if (!res.ok) {
      console.warn(`[Push] Expo push service responded ${res.status} for user ${userId}`);
      return;
    }

    // Expo returns HTTP 200 even for a rejected/invalid token — the actual
    // per-notification result lives in the response body.
    const json = await res.json();
    const ticket = json?.data;
    if (ticket && ticket.status === "error") {
      console.warn(`[Push] Delivery error for user ${userId}: ${ticket.message}`);
      if (ticket.details?.error === "DeviceNotRegistered") {
        // The app was uninstalled or the token otherwise expired — stop
        // trying to notify a token that will only ever fail.
        await db.setPushToken(userId, null);
      }
    }
  } catch (err) {
    console.warn(`[Push] Failed to send notification to user ${userId}:`, err.message);
  }
}

module.exports = { sendPushNotification };
