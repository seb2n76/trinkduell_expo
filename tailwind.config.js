/** @type {import('tailwindcss').Config} */

// Semantische Farben statt fester Paletten-Toene.
//
// `bg-surface` sagt, WOFUER die Farbe da ist; `bg-slate-900` sagt nur, WELCHE
// sie ist — und genau deshalb liess sich die App bisher nicht umschalten.
//
// Die Werte stehen als CSS-Variablen HIER und nicht in global.css: auf iOS und
// Android gibt es keine CSS-Datei, dort liest NativeWind die Variablen aus der
// Tailwind-Config. In global.css definiert haetten sie nur im Browser gewirkt.
//
// Schreibweise `rgb(var(--x) / <alpha-value>)`: so bleiben Opazitaets-Modifier
// wie `bg-surface/50` oder `border-accent/30` benutzbar.

const TOKENS = [
  "bg",
  "surface",
  "surface-alt",
  "line",
  "line-strong",
  "content",
  "content-muted",
  "content-faint",
  "accent",
  "accent-ink",
  "accent-2",
  "accent-2-ink",
  "success",
  "warning",
  "danger",
  "on-accent",
];

// RGB-Tripel ohne rgb() — das verlangt die <alpha-value>-Schreibweise oben.
const LIGHT = {
  bg: "248 250 252", // slate-50
  surface: "255 255 255", // weiss
  "surface-alt": "241 245 249", // slate-100
  line: "226 232 240", // slate-200
  "line-strong": "203 213 225", // slate-300
  content: "15 23 42", // slate-900
  "content-muted": "71 85 105", // slate-600
  "content-faint": "100 116 139", // slate-500
  accent: "8 145 178", // cyan-600
  // Cyan #22d3ee scheitert auf Weiss am Kontrast (rund 1.9:1). Fuer Text auf
  // dem Seitengrund deshalb ein tieferer Ton als fuer Flaechen und Icons.
  "accent-ink": "14 116 144", // cyan-700
  "accent-2": "147 51 234", // purple-600
  "accent-2-ink": "126 34 206", // purple-700
  // emerald-600 waere naheliegender, kommt auf Weiss aber nur auf 3.77:1 und
  // reisst damit die Lesbarkeitsgrenze von 4.5:1. emerald-700 schafft 4.95:1.
  success: "4 120 87", // emerald-700
  warning: "180 83 9", // amber-700
  danger: "225 29 72", // rose-600
  "on-accent": "255 255 255",
};

// Die bisherige Optik, Wert fuer Wert uebernommen.
const DARK = {
  bg: "2 6 23", // slate-950
  surface: "15 23 42", // slate-900
  "surface-alt": "2 6 23", // slate-950
  line: "30 41 59", // slate-800
  "line-strong": "51 65 85", // slate-700
  content: "255 255 255",
  "content-muted": "148 163 184", // slate-400
  "content-faint": "100 116 139", // slate-500
  accent: "34 211 238", // cyan-400
  "accent-ink": "34 211 238", // auf Dunkel gut lesbar, kein zweiter Ton noetig
  "accent-2": "192 132 252", // purple-400
  "accent-2-ink": "192 132 252",
  success: "52 211 153", // emerald-400
  warning: "251 191 36", // amber-400
  danger: "244 63 94", // rose-500
  "on-accent": "2 6 23",
};

const asVars = (palette) =>
  Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--td-${k}`, v]));

module.exports = {
  content: ["./src/app/**/*.{js,jsx,ts,tsx}", "./src/components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  // Pflicht fuer setColorScheme() aus nativewind — ohne das wirft der Aufruf.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Semantische Tokens ────────────────────────────────────────────
        ...Object.fromEntries(
          TOKENS.map((name) => [name, `rgb(var(--td-${name}) / <alpha-value>)`])
        ),

        // ── Bestand ───────────────────────────────────────────────────────
        // Bleibt, solange noch nicht migrierte Screens diese Toene benutzen.
        // Faellt weg, sobald die Migration durch ist.
        slate: { 950: "#020617" },
        fuchsia: { 500: "#d946ef" },
        cyan: { 400: "#22d3ee" },
        emerald: { 500: "#10b981" },
        yellow: { 400: "#facc15" },
        rose: { 500: "#f43f5e" },
      },
    },
  },
  plugins: [
    ({ addBase }) =>
      addBase({
        // Hell als Grundzustand, Dunkel als Ausnahme darueber: ein Fallback
        // ohne jede Klasse soll lesbar sein, nicht schwarz auf schwarz.
        ":root": asVars(LIGHT),
        ".dark:root": asVars(DARK),
        ".dark": asVars(DARK),
      }),
  ],
};
