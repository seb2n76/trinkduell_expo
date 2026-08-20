import { StoryGameId, StoryGameMeta } from "../storyEngine/types";

/**
 * Anzeigedaten der Story-Spiele für Katalog und Lobby.
 *
 * Bewusst NUR Anzeige: Kapitel, Rollen, Auswahl-Effekte und die Auswertung
 * des Finales liegen seit August 2026 ausschließlich auf dem Server unter
 * `server/games/stories/*.json`. Hier stünden sie ein zweites Mal — und zwei
 * Quellen für denselben Text laufen garantiert auseinander.
 *
 * Diese Werte müssen mit den gleichnamigen Feldern der JSON-Definitionen
 * übereinstimmen. Sie stehen trotzdem hier, damit der Spielekatalog auch
 * ohne Netz etwas anzeigen kann.
 */
export const STORY_GAMES: Record<StoryGameId, StoryGameMeta> = {
  court_treason: {
    id: "court_treason",
    title: "Der Verrat am Königshof",
    subtitle: "Game of Thrones trifft Social Deduction & Trink-Diplomatie",
    genre: "Intrigen & Rollenspiel",
    durationMinutes: 25,
    minPlayers: 3,
    maxPlayers: 12,
    themeColor: "#b45309",
    accentColor: "#fbbf24",
    icon: "crown",
    tagline: "Wer goss das Gift in den königlichen Kelch?",
    description:
      "Der König liegt vergiftet auf dem Thronsaal. Ein Attentäter sitzt mit am Tisch! Schafft es der Inquisitor, die Wahrheit ans Licht zu bringen, oder verurteilt der Kronrat die Falschen?",
  },
  murder_express: {
    id: "murder_express",
    title: "Mord im Mitternachts-Express",
    subtitle: "1920s Noir Whodunnit & Kreuzverhör",
    genre: "Krimi & Social Deduction",
    durationMinutes: 25,
    minPlayers: 3,
    maxPlayers: 12,
    themeColor: "#0284c7",
    accentColor: "#38bdf8",
    icon: "train",
    tagline: "Ein Schneesturm, ein Toter und kein Alibi.",
    description:
      "Der Luxuszug steht tief im Gebirge still. Baron von Falkenstein liegt tot im Salonwagen! Jeder Passagier verbirgt ein dunkles Geheimnis.",
  },
  haunted_manor: {
    id: "haunted_manor",
    title: "Escape the Haunted Manor",
    subtitle: "Co-Op Horror Survival & Geister-Besessenheit",
    genre: "Survival-Horror & Co-Op",
    durationMinutes: 20,
    minPlayers: 3,
    maxPlayers: 12,
    themeColor: "#4c1d95",
    accentColor: "#a855f7",
    icon: "skull",
    tagline: "Überlebt die Nacht in der verfluchten Villa.",
    description:
      "Ihr seid in einer Geistervilla gefangen! Das Team teilt sich 100 Lebenspunkte. Findet die 3 Bann-Schlüssel, bevor der Dämon euch alle besitzt!",
  },
};

export const STORY_GAMES_LIST: StoryGameMeta[] = [
  STORY_GAMES.court_treason,
  STORY_GAMES.murder_express,
  STORY_GAMES.haunted_manor,
];

export function getStoryGame(id: StoryGameId): StoryGameMeta {
  return STORY_GAMES[id] || STORY_GAMES.court_treason;
}
