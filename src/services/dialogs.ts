import { Alert, Platform } from "react-native";

/**
 * Alert.alert does nothing at all on react-native-web, so every confirmation
 * and error message built on it was invisible in the browser — actions
 * appeared to do nothing. These two helpers pick the right mechanism per
 * platform and are the only way this app should ask or tell.
 *
 * They used to live as local closures inside the tabs layout; every screen
 * split out of it needs the same behaviour, so they belong here.
 */

/** Shows a message. One button, nothing to decide. */
export const notify = (title: string, message: string): void => {
  if (Platform.OS === "web") {
    window.alert(message);
    return;
  }
  Alert.alert(title, message);
};

/**
 * Asks before doing something that cannot be undone.
 *
 * `confirmLabel` names the destructive button ("Entfernen", "Verlassen", …) —
 * a button that says what it does is worth more than a generic "Bestätigen"
 * when the dialog is the last stop before data is gone.
 */
export const confirmAction = (
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  confirmLabel = "Bestätigen"
): void => {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) void onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Abbrechen", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: () => void onConfirm() },
  ]);
};
