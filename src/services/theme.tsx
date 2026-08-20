import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "nativewind";

/**
 * Farbschema der App.
 *
 * Zwei Wege fuehren zur selben Farbe, weil React Native beide braucht:
 *
 *   Klassen  `bg-surface`, `text-content`   → CSS-Variablen (global.css)
 *   Werte    `color={c.accent}` bei Icons   → useThemeColors()
 *
 * Ionicons und Inline-Styles nehmen keine Tailwind-Klasse entgegen, sondern
 * einen echten Farbwert. Die beiden Listen muessen deshalb uebereinstimmen —
 * global.css ist die Quelle, PALETTE hier die Spiegelung davon.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "trinkduell_theme_preference";

/** Bisheriges Verhalten bleibt die Vorgabe: wer nichts einstellt, bekommt Dunkel. */
const DEFAULT_PREFERENCE: ThemePreference = "dark";

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  line: string;
  lineStrong: string;
  content: string;
  contentMuted: string;
  contentFaint: string;
  accent: string;
  accentInk: string;
  accent2: string;
  accent2Ink: string;
  success: string;
  warning: string;
  danger: string;
  onAccent: string;
}

const PALETTE: Record<"light" | "dark", ThemeColors> = {
  light: {
    bg: "#f8fafc",
    surface: "#ffffff",
    surfaceAlt: "#f1f5f9",
    line: "#e2e8f0",
    lineStrong: "#cbd5e1",
    content: "#0f172a",
    contentMuted: "#475569",
    contentFaint: "#64748b",
    accent: "#0891b2",
    accentInk: "#0e7490",
    accent2: "#9333ea",
    accent2Ink: "#7e22ce",
    // emerald-700 statt -600: auf Weiss kommt -600 nur auf 3.77:1.
    success: "#047857",
    warning: "#b45309",
    danger: "#e11d48",
    onAccent: "#ffffff",
  },
  dark: {
    bg: "#020617",
    surface: "#0f172a",
    surfaceAlt: "#020617",
    line: "#1e293b",
    lineStrong: "#334155",
    content: "#ffffff",
    contentMuted: "#94a3b8",
    contentFaint: "#64748b",
    accent: "#22d3ee",
    accentInk: "#22d3ee",
    accent2: "#c084fc",
    accent2Ink: "#c084fc",
    success: "#34d399",
    warning: "#fbbf24",
    danger: "#f43f5e",
    onAccent: "#020617",
  },
};

interface ThemeContextValue {
  /** Was der Nutzer gewaehlt hat. */
  preference: ThemePreference;
  /** Was daraus tatsaechlich folgt — "system" ist hier schon aufgeloest. */
  scheme: "light" | "dark";
  colors: ThemeColors;
  setPreference: (next: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: DEFAULT_PREFERENCE,
  scheme: "dark",
  colors: PALETTE.dark,
  setPreference: async () => {},
});

export const useTheme = () => useContext(ThemeContext);

/** Kurzform fuer den haeufigsten Fall: nur die Farbwerte. */
export const useThemeColors = (): ThemeColors => useContext(ThemeContext).colors;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_PREFERENCE);

  // Gespeicherte Wahl anwenden. Bis sie geladen ist, gilt die Vorgabe —
  // dadurch startet die App im selben Aussehen wie bisher und schaltet
  // hoechstens einmal um, statt hell aufzublitzen.
  useEffect(() => {
    (async () => {
      let gespeichert: ThemePreference = DEFAULT_PREFERENCE;
      try {
        const wert = await AsyncStorage.getItem(STORAGE_KEY);
        if (wert === "system" || wert === "light" || wert === "dark") gespeichert = wert;
      } catch (e) {
        console.warn("Farbschema konnte nicht gelesen werden:", e);
      }
      setPreferenceState(gespeichert);
      setColorScheme(gespeichert);
    })();
  }, [setColorScheme]);

  const setPreference = useCallback(
    async (next: ThemePreference) => {
      // Erst umschalten, dann speichern: die Anzeige soll nicht auf die
      // Festplatte warten, und ein fehlgeschlagenes Speichern ist kein Grund,
      // die Wahl zu verweigern.
      setPreferenceState(next);
      setColorScheme(next);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        console.warn("Farbschema konnte nicht gespeichert werden:", e);
      }
    },
    [setColorScheme]
  );

  // colorScheme kommt von NativeWind und hat "system" bereits aufgeloest.
  const scheme: "light" | "dark" = colorScheme === "light" ? "light" : "dark";

  return (
    <ThemeContext.Provider
      value={{ preference, scheme, colors: PALETTE[scheme], setPreference }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
