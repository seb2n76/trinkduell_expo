import React from "react";
import { KeyboardAvoidingView, Platform, ViewStyle } from "react-native";

/**
 * Schiebt den Inhalt hoch, wenn die Tastatur aufgeht.
 *
 * Bis August 2026 gab es das nur auf den drei Anmeldebildschirmen. Überall
 * sonst — Chat, Feed-Eingabe, Freundesuche, Gruppen-Namen, Raum-Code,
 * Passwortwechsel — legte sich die Tastatur über genau das Feld, in das man
 * gerade tippen wollte. Auf iOS ist das besonders unangenehm, weil dort ohne
 * dieses Element gar nichts nachrückt.
 *
 * `behavior` unterscheidet sich bewusst nach Plattform: iOS braucht
 * "padding", Android kommt mit "height" zurecht (und regelt einen Teil schon
 * über den Fenstermodus des Systems). Im Browser gibt es keine Bildschirm-
 * tastatur, die etwas verdecken könnte — dort ist das Element wirkungslos und
 * stört nicht.
 *
 * `offset` ist für Bildschirme mit fester Kopfzeile gedacht: ohne ihn schiebt
 * iOS um die Höhe der Kopfzeile zu weit.
 */
export function KeyboardSafe({
  children,
  offset = 0,
  style,
}: {
  children: React.ReactNode;
  offset?: number;
  style?: ViewStyle;
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={offset}
      style={[{ flex: 1 }, style]}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

export default KeyboardSafe;
