import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ErrorBoundaryProps } from "expo-router";

/**
 * Was zu sehen ist, wenn ein Screen beim Rendern abstürzt.
 *
 * Bis zum 21.08.2026 gab es dafür gar nichts. Ein Fehler beim Rendern —
 * ein fehlendes Feld in einer Antwort, ein `undefined.map()` — riss die
 * gesamte App mit: im Browser in einen weißen Bildschirm ohne jede Meldung,
 * nativ in einen Absturz. Für eine Beta ist das der ungünstigste Ausgang,
 * weil der Tester nichts berichten kann außer „war plötzlich weg".
 *
 * `expo-router` nimmt jede aus einer Route exportierte `ErrorBoundary` und
 * legt sie um genau diese Route. Deshalb steht der Bildschirm hier einmal
 * und wird in `app/_layout.tsx` (fängt alles) und `app/(tabs)/_layout.tsx`
 * (fängt einen einzelnen Reiter, ohne die Navigation mitzunehmen)
 * wiederverwendet.
 *
 * Die Farben kommen NICHT aus `useThemeColors()`: Die Fehlergrenze der
 * Wurzelroute wird anstelle des Layouts gerendert, der ThemeProvider ist
 * dann gar nicht montiert. Ein Haken, der auf seinen Kontext wartet, würde
 * hier ein zweites Mal werfen — und diesmal fängt es niemand mehr.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const dunkel = useColorScheme() !== "light";
  const [zeigeDetails, setZeigeDetails] = useState(false);

  const farben = dunkel
    ? { bg: "#0b111e", flaeche: "#161f30", linie: "#243049", text: "#e2e8f0", leise: "#94a3b8", akzent: "#22d3ee", akzentText: "#0b111e" }
    : { bg: "#f8fafc", flaeche: "#ffffff", linie: "#e2e8f0", text: "#0f172a", leise: "#475569", akzent: "#0891b2", akzentText: "#ffffff" };

  return (
    <View style={{ flex: 1, backgroundColor: farben.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <View
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: farben.flaeche,
          borderColor: farben.linie,
          borderWidth: 1,
          borderRadius: 24,
          padding: 24,
        }}
      >
        <View style={{ alignItems: "center", marginBottom: 16 }}>
          <Ionicons name="warning-outline" size={40} color={farben.akzent} />
        </View>

        <Text style={{ color: farben.text, fontSize: 18, fontWeight: "900", textAlign: "center", marginBottom: 8 }}>
          Da ist etwas schiefgegangen
        </Text>

        <Text style={{ color: farben.leise, fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: 20 }}>
          Dieser Bereich konnte nicht angezeigt werden. Deine Daten sind nicht
          betroffen — sie liegen auf dem Server, nicht in dieser Ansicht.
        </Text>

        <TouchableOpacity
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="Ansicht erneut laden"
          style={{
            backgroundColor: farben.akzent,
            paddingVertical: 14,
            borderRadius: 16,
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <Text style={{ color: farben.akzentText, fontWeight: "900", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }}>
            Erneut versuchen
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setZeigeDetails((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={zeigeDetails ? "Technische Details ausblenden" : "Technische Details anzeigen"}
          style={{ paddingVertical: 10, alignItems: "center" }}
        >
          <Text style={{ color: farben.leise, fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
            {zeigeDetails ? "Details ausblenden" : "Technische Details"}
          </Text>
        </TouchableOpacity>

        {/* Ausklappbar statt dauerhaft sichtbar: Für die Meldung an den
            Betreiber ist die Fehlerzeile Gold wert, für alle anderen ist sie
            nur beunruhigend. */}
        {zeigeDetails && (
          <ScrollView
            style={{
              maxHeight: 160,
              backgroundColor: farben.bg,
              borderColor: farben.linie,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              marginTop: 4,
            }}
          >
            <Text selectable style={{ color: farben.leise, fontSize: 11, lineHeight: 16 }}>
              {error?.message || "Unbekannter Fehler"}
              {error?.stack ? `\n\n${error.stack}` : ""}
            </Text>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/**
 * Der Name, den `expo-router` erwartet. Routen re-exportieren ihn:
 * `export { ErrorBoundary } from "@/components/ErrorScreen";`
 */
export const ErrorBoundary = ErrorScreen;

export default ErrorScreen;
