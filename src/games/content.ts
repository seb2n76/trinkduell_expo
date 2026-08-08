/**
 * Content for the party games, kept out of the screen components so the
 * games themselves stay small and the texts are easy to extend.
 *
 * Tone: every prompt offers a way out ("oder trinke"), and nothing tells
 * people to empty a glass or race each other. A sip is always enough, and
 * players can take a non-alcoholic drink instead — the app's whole point is
 * a fun evening, not maximum consumption.
 */

export type Intensity = "harmlos" | "party" | "spicy";

export const INTENSITY_LABELS: Record<Intensity, string> = {
  harmlos: "Harmlos",
  party: "Party",
  spicy: "Prickelnd 18+",
};

// ─── Ich hab noch nie ─────────────────────────────────────────────────────
// Wer es schon gemacht hat, nimmt einen Schluck.
export const NEVER_HAVE_I_EVER: Record<Intensity, string[]> = {
  harmlos: [
    "…ein ganzes Wochenende nur Serien geschaut.",
    "…mich im eigenen Wohnort verlaufen.",
    "…einen Wecker gestellt und trotzdem verschlafen.",
    "…heimlich das Essen von jemand anderem probiert.",
    "…jemanden auf der Straße gegrüßt, den ich gar nicht kannte.",
    "…einen Film geschaut und behauptet, ich hätte das Buch gelesen.",
    "…mir selbst eine Nachricht geschrieben, um nichts zu vergessen.",
    "…beim Karaoke mitgesungen, obwohl ich den Text nicht kannte.",
    "…drei Tage hintereinander dasselbe Shirt getragen.",
    "…einen Kochversuch so verbockt, dass wir bestellen mussten.",
    "…im Supermarkt etwas gekauft, nur weil es im Angebot war.",
    "…mich vor einem Tier erschrocken, das kleiner war als meine Hand.",
  ],
  party: [
    "…auf einer Party getanzt, obwohl niemand sonst getanzt hat.",
    "…am Morgen danach mein Handy nach Fotos durchsucht.",
    "…einen Kater mit fettigem Essen bekämpft.",
    "…an einer Bushaltestelle eingeschlafen.",
    "…jemandem ein Getränk ausgegeben, um ins Gespräch zu kommen.",
    "…die letzte Bahn verpasst und laufen müssen.",
    "…um 3 Uhr nachts noch Pizza bestellt.",
    "…einer fremden Person auf einer Party mein Leben erzählt.",
    "…behauptet, ich gehe früh, und bin bis zum Schluss geblieben.",
    "…mich am nächsten Tag für eine Sprachnachricht entschuldigt.",
    "…auf einer Feier eingeschlafen, während die anderen weiterfeierten.",
    "…mein Getränk verwechselt und aus dem falschen Glas getrunken.",
  ],
  spicy: [
    "…jemanden geküsst, dessen Namen ich nicht mehr weiß.",
    "…mit zwei Personen am selben Abend geflirtet.",
    "…eine Nachricht geschrieben, die ich sofort zurücknehmen wollte.",
    "…jemanden aus diesem Raum attraktiv gefunden.",
    "…einen Ex-Partner nachts angerufen.",
    "…in der Öffentlichkeit geknutscht.",
    "…jemanden über soziale Medien gestalkt, bevor wir uns trafen.",
    "…so getan, als wäre ich vergeben, um jemanden loszuwerden.",
    "…ein Date abgebrochen, weil es zu schlecht lief.",
    "…jemandem gesagt, dass ich ihn mag, nur weil ich getrunken hatte.",
  ],
};

// ─── Wer würde eher…? ─────────────────────────────────────────────────────
// Die Gruppe zeigt auf eine Person, wer die meisten Stimmen hat, trinkt.
export const WHO_WOULD_RATHER: Record<Intensity, string[]> = {
  harmlos: [
    "Wer würde eher verschlafen und trotzdem pünktlich sein?",
    "Wer würde eher einen ganzen Kuchen alleine essen?",
    "Wer würde eher beim Wandern die Abkürzung nehmen und sich verlaufen?",
    "Wer würde eher ein Haustier nach einer Serienfigur benennen?",
    "Wer würde eher bei einer Quizshow mitmachen?",
    "Wer würde eher aus Versehen die falsche Person umarmen?",
    "Wer würde eher stundenlang über ein Hobby reden?",
    "Wer würde eher ohne Navi losfahren?",
  ],
  party: [
    "Wer würde eher als Erstes auf der Tanzfläche stehen?",
    "Wer würde eher die After-Party bei sich zu Hause veranstalten?",
    "Wer würde eher am nächsten Morgen als Erstes wieder fit sein?",
    "Wer würde eher das Mikrofon beim Karaoke nicht mehr hergeben?",
    "Wer würde eher eine Runde für alle ausgeben?",
    "Wer würde eher aus Versehen im falschen Bus einschlafen?",
    "Wer würde eher mit dem Türsteher Freundschaft schließen?",
    "Wer würde eher am Ende des Abends alle nach Hause bringen?",
  ],
  spicy: [
    "Wer würde eher jemanden im Club ansprechen?",
    "Wer würde eher ein Date direkt am selben Abend ausmachen?",
    "Wer würde eher ein Geheimnis ausplaudern?",
    "Wer würde eher seinem Schwarm nachts schreiben?",
    "Wer würde eher bei Wahrheit immer die Pflicht wählen?",
    "Wer würde eher jemanden aus der Runde daten?",
  ],
};

// ─── Wortbombe: Kategorien ────────────────────────────────────────────────
export const WORD_BOMB_CATEGORIES: string[] = [
  "Biersorten",
  "Cocktails",
  "Automarken",
  "Länder in Europa",
  "Filme mit einem Wort im Titel",
  "Dinge in einer Küche",
  "Tiere mit vier Beinen",
  "Fußballvereine",
  "Serien",
  "Dinge, die man mit auf ein Festival nimmt",
  "Musikinstrumente",
  "Süßigkeiten",
  "Berufe",
  "Dinge am Strand",
  "Pizzabeläge",
  "Städte in Deutschland",
];

/** Zufälliges Element, ohne das zuletzt gezeigte zu wiederholen. */
export function pickRandom<T>(list: T[], exclude?: T): T {
  if (list.length === 0) throw new Error("pickRandom: leere Liste");
  if (list.length === 1) return list[0];
  let item = list[Math.floor(Math.random() * list.length)];
  let guard = 0;
  while (exclude !== undefined && item === exclude && guard < 10) {
    item = list[Math.floor(Math.random() * list.length)];
    guard++;
  }
  return item;
}
