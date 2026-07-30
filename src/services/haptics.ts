import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type HapticFeedbackType = "success" | "error" | "light" | "medium" | "heavy";

export const triggerHaptic = async (type: HapticFeedbackType): Promise<void> => {
  // Silent fallback for Web/unsupported platforms
  if (Platform.OS === "web") {
    return;
  }
  
  try {
    switch (type) {
      case "success":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case "error":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case "light":
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case "medium":
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case "heavy":
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
    }
  } catch (error) {
    console.warn("Haptic feedback failed to trigger:", error);
  }
};
