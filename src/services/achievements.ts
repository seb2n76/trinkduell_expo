/**
 * Katalog der Erfolge für die Anzeige im Profil.
 *
 * Lag bis zur Navigations-Umstellung im Tab-Layout, weil der Drawer die
 * einzige Stelle war, die ihn braucht. Jetzt liegt die Anzeige auf einem
 * eigenen Screen, also gehört die Liste in ein Modul.
 *
 * ACHTUNG: Es gibt eine zweite, kürzere Liste in
 * `src/components/AchievementModal.tsx` (ACHIEVEMENTS_METADATA) für die
 * Freischalt-Meldung. Die beiden sind nicht synchron — dort fehlen
 * DRIVER_OF_THE_NIGHT, HYDRO_HOMIE und UEBERLEBENSKUENSTLER.
 */
export interface AchievementDef {
  id: string;
  name: string;
  icon: string;
  criteria: string;
  color: string;
  colorHex: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "FIRST_DRINK", name: "Erste Erfrischung", icon: "beer-outline", criteria: "Dein allererstes Getränk wurde erfolgreich geloggt.", color: "text-cyan-400", colorHex: "#22d3ee" },
  { id: "SOMMELIER", name: "Vielfalt-Liebhaber", icon: "wine-outline", criteria: "Getränke aus mindestens 3 verschiedenen Kategorien getrunken.", color: "text-purple-400", colorHex: "#c084fc" },
  { id: "NACHTEULE", name: "Nachteule", icon: "moon-outline", criteria: "Ein Getränk zwischen 2 und 5 Uhr morgens geloggt.", color: "text-fuchsia-400", colorHex: "#e879f9" },
  { id: "BRAUMEISTER", name: "Braumeister", icon: "beer", criteria: "Mindestens 5 Biere erfolgreich geloggt.", color: "text-yellow-400", colorHex: "#fbbf24" },
  { id: "STAMMGAST", name: "Kult-Stammgast", icon: "trophy", criteria: "Kultstatus! Mindestens 50 Biere geloggt.", color: "text-amber-500", colorHex: "#f59e0b" },
  { id: "FRUEHSCHOPPEN", name: "Frühschoppen", icon: "sunny-outline", criteria: "Ein alkoholisches Getränk vor 12 Uhr mittags geloggt.", color: "text-orange-400", colorHex: "#fb923c" },
  { id: "SAMMLER", name: "Genuss-Sammler", icon: "ribbon-outline", criteria: "Mindestens 10 verschiedene Getränke-Typen probiert.", color: "text-rose-400", colorHex: "#fb7185" },
  { id: "ANFUEHRER", name: "Der Anführer", icon: "people", criteria: "Du bist Administrator einer eigenen Freundesgruppe.", color: "text-emerald-400", colorHex: "#34d399" },
  { id: "DRIVER_OF_THE_NIGHT", name: "Driver of the Night", icon: "car-outline", criteria: "0,0g Alkohol am Abend (mindestens 1 alkoholfreies Getränk geloggt).", color: "text-blue-400", colorHex: "#60a5fa" },
  { id: "HYDRO_HOMIE", name: "Hydro-Homie", icon: "water", criteria: "Mindestens 3 Wasser hintereinander geloggt, ohne Alkohol dazwischen.", color: "text-sky-400", colorHex: "#38bdf8" },
  { id: "UEBERLEBENSKUENSTLER", name: "Überlebenskünstler", icon: "heart-outline", criteria: "Ein lebensrettendes Wasser nach 04:00 Uhr morgens geloggt.", color: "text-teal-400", colorHex: "#2dd4bf" },
];
