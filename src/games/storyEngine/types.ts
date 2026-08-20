/**
 * Typen für die Multi-Device-Story-Spiele.
 *
 * Seit August 2026 liegt die Spiellogik ausschließlich auf dem Server
 * (`server/games/`). Der Client kennt weder Kapitel noch Rollenverteilung
 * noch die Effekte einer Auswahl — er rendert, was der Raumzustand hergibt,
 * und schickt Absichten zurück.
 *
 * Vorher rechnete der Client des Hosts das Spiel aus. Punkte und Schaden
 * einer Auswahl kamen deshalb nirgends an, die Team-HP-Leiste bewegte sich
 * nie, und der Host konnte Rollen und Ausgang bestimmen. Was hier fehlt, ist
 * Absicht: alles, was der Client nicht kennt, kann er nicht fälschen.
 */

export type StoryGameId = "court_treason" | "murder_express" | "haunted_manor";

/** Anzeigedaten für Katalog und Lobby. Kein Spielinhalt. */
export interface StoryGameMeta {
  id: StoryGameId;
  title: string;
  subtitle: string;
  genre: string;
  durationMinutes: number;
  minPlayers: number;
  maxPlayers: number;
  themeColor: string;
  accentColor: string;
  icon: string;
  tagline: string;
  description: string;
}

// ─── Raumzustand, wie der Server ihn liefert ────────────────────────────────

export interface RoomPlayer {
  id: string;
  name: string;
  avatar?: string | null;
  isHost: boolean;
  isReady: boolean;
  points: number;
  sipsTaken: number;
  hasSubmittedAction: boolean;
  /** Hat im aktuellen Kapitel gewählt — was, bleibt geheim. */
  hasChosen: boolean;
  /** Nur die eigene Rolle, oder alle im Finale. */
  role: string | null;
  allegiance: "town" | "traitor" | "neutral" | null;
  secretPrompt: string | null;
}

export interface ChapterChoice {
  id: string;
  label: string;
  /** Verlangt die Auswahl einer Zielperson. */
  targetRequired: boolean;
}

export interface CurrentChapter {
  id: string;
  act: number;
  index: number;
  title: string;
  atmosphereHint: string | null;
  /** Fertig gerendert — die Namen stehen schon drin. */
  text: string;
  prompt: {
    title: string;
    description: string;
    choices: ChapterChoice[];
  } | null;
  voting: { prompt: string } | null;
}

/**
 * Aktuelle Phase mit absoluter Frist.
 *
 * `deadlineAt` ist ein Zeitstempel der SERVERUHR. Der Client bildet aus
 * `StoryRoom.serverTime` seinen Versatz und rechnet den Countdown daraus —
 * niemals gegen die eigene Uhr, sonst laufen acht Geräte auseinander.
 */
export interface PhaseInfo {
  kind: "choice" | "reveal" | "vote";
  startedAt: number;
  deadlineAt: number;
  seconds: number;
}

/** Was jemand gewählt hat. Erst in der Auflösungsphase gefüllt. */
export interface ChoiceReveal {
  playerId: string;
  playerName: string;
  /** null = hat die Frist verstreichen lassen. */
  choiceId: string | null;
  label: string | null;
  outcomeText: string | null;
  targetName: string | null;
}

export interface FinaleResult {
  outcomeKey: string;
  winnerTeam: string;
  title: string;
  summary: string;
  drinkPenalties: { playerName: string; sips: number; reason: string }[];
}

export interface StoryRoom {
  code: string;
  gameId: StoryGameId;
  hostId: string;
  status: "lobby" | "role_reveal" | "story_chapter" | "finale";
  /** Erhöht sich bei jedem echten Zustandswechsel. */
  revision: number;
  currentChapterIndex: number;
  players: RoomPlayer[];
  gameState: {
    storyLog: string[];
    currentChapter: CurrentChapter | null;
    variables: Record<string, number>;
    healthPoints?: number;
    phase: PhaseInfo | null;
    reveals: ChoiceReveal[] | null;
    myChoice: { choiceId: string; outcomeText: string; targetPlayerId: string | null } | null;
    choiceCount: number;
    voteCount: number;
    finalVotes?: Record<string, string>;
    finale: FinaleResult | null;
  };
  isHost: boolean;
  myPlayerId: string;
  serverTime: number;
}
