import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiService } from "./api";

// Show notifications while the app is in the foreground too, not just when
// backgrounded/closed.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Requests permission (if not already granted/denied) and registers this
// device's Expo push token with the backend. Safe to call repeatedly (e.g.
// after every login) — it's a no-op once permission has already been
// decided and the token rarely changes.
export async function registerForPushNotificationsAsync(): Promise<void> {
  if (Platform.OS === "web") {
    // Expo's push token flow targets native devices; web push needs its own
    // VAPID setup this app doesn't have yet.
    return;
  }

  if (!Device.isDevice) {
    console.log("[Notifications] Push notifications require a physical device (not a simulator).");
    return;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("[Notifications] Permission not granted, skipping push token registration.");
      return;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    await apiService.registerPushToken(tokenResponse.data);
  } catch (error) {
    console.warn("[Notifications] Failed to register for push notifications:", error);
  }
}

// Routes a tapped notification to a sensible screen based on its data.type,
// set by the corresponding server/index.js sendPushNotification() call.
export function getRouteForNotificationData(data: Record<string, unknown> | undefined): string {
  const type = data?.type;
  if (type === "duel_challenge" || type === "duel_accepted") {
    return "/(tabs)/games";
  }
  if (type === "group_join_request") {
    return "/notifications";
  }
  // friend_request / friend_accepted and anything unrecognized: no dedicated
  // route (friend management lives in the tabs drawer modal), fall back to
  // the dashboard.
  return "/(tabs)";
}
