import React, { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, View, ViewStyle } from "react-native";

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

/**
 * Einblendart für transparente Blätter.
 *
 * react-native-web führt die Slide-Animation eines TRANSPARENTEN Modals nicht
 * aus: Das Overlay bleibt bei `translateY(Bildschirmhöhe)` stehen und liegt
 * damit vollständig unterhalb des sichtbaren Bereichs. Der Dialog ist im DOM,
 * reagiert auf nichts und ist unsichtbar — in der Web-App liessen sich dadurch
 * weder Getränke auswählen noch anlegen, und auch Gruppen, Events und
 * Meldungen waren nicht erreichbar.
 *
 * Nachgemessen: derselbe Dialog mit "fade" erscheint normal, mit "slide" steht
 * er bei translateY(812) auf einem 812 Pixel hohen Fenster. Vollbild-Modals
 * (`transparent={false}`) sind nicht betroffen.
 *
 * Auf iOS und Android bleibt es beim Hochschieben — dort funktioniert es.
 */
export const SHEET_ANIMATION: "slide" | "fade" = Platform.OS === "web" ? "fade" : "slide";

/**
 * Rahmen für Dialoge, die am unteren Bildschirmrand sitzen („Blätter").
 *
 * Warum nicht einfach KeyboardSafe darüber?
 * Ein <Modal> rendert auf Android in einem EIGENEN Fenster. Ein
 * KeyboardAvoidingView, das außerhalb des Modals steht, erreicht dessen Inhalt
 * gar nicht — das Blatt blieb deshalb unter der Tastatur liegen, obwohl der
 * Bildschirm darunter längst geschützt war. Und ein KeyboardAvoidingView
 * INNERHALB eines Modals verhält sich auf Android je nach Fenstermodus
 * unterschiedlich.
 *
 * Deshalb hier der direkte Weg: die Tastaturhöhe abhören und als Abstand nach
 * unten setzen. Das Blatt rutscht damit genau auf die Tastatur — das Eingabe-
 * feld sitzt unmittelbar darüber, statt darunter zu verschwinden.
 *
 * Lieber etwas zu viel Abstand als zu wenig: sitzt das Blatt ein paar Pixel zu
 * hoch, sieht man es. Sitzt es zu tief, ist es weg.
 */
export function KeyboardSheet({
  children,
  className = "flex-1 bg-black/85 justify-end",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [tastaturHoehe, setTastaturHoehe] = useState(0);

  useEffect(() => {
    // iOS meldet vor der Animation, Android erst danach — wer auf iOS
    // "DidShow" nimmt, sieht das Blatt sichtbar nachspringen.
    const zeigen = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const verbergen = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const auf = Keyboard.addListener(zeigen, (e) =>
      setTastaturHoehe(e?.endCoordinates?.height ?? 0)
    );
    const zu = Keyboard.addListener(verbergen, () => setTastaturHoehe(0));
    return () => {
      auf.remove();
      zu.remove();
    };
  }, []);

  return (
    <View className={className} style={{ paddingBottom: tastaturHoehe }}>
      {children}
    </View>
  );
}

export default KeyboardSafe;
