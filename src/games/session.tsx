import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * „Die Nacht" — der Session-Layer über den lokalen Pass-the-Phone-Spielen.
 *
 * Die acht lokalen Spiele waren bis August 2026 Karten-Shuffler: zufälliger
 * Text, Knopf, wiederholen. Kein Punktestand, keine Rundenstruktur, kein Ende,
 * keine Eskalation — die fünfzehnte Karte fühlte sich an wie die erste.
 *
 * Was diese Spiele über eine halbe Stunde trägt, ist nicht Geheimwissen (ein
 * Gerät, alle sehen mit), sondern ZUSTAND, der sich anhäuft: Punkte, die über
 * den Spielwechsel hinweg weiterlaufen, Regeln, die gelten bleiben, und Akte,
 * die den Einsatz erhöhen. Genau das hält dieser Kontext.
 */

const STORAGE_KEY = "trinkduell_night_session";

/** Ab welcher Runde welcher Akt läuft. Index = Akt - 1. */
const ACT_THRESHOLDS = [0, 8, 18];

/** Punkte-Multiplikator je Akt — der Einsatz steigt sichtbar. */
const ACT_MULTIPLIER: Record<number, number> = { 1: 1, 2: 2, 3: 3 };

export const ACT_LABEL: Record<number, string> = {
  1: "Akt I · Aufwärmen",
  2: "Akt II · Eskalation",
  3: "Akt III · Finale",
};

/** Joker pro Spieler zu Sessionbeginn. */
const START_JOKERS = 2;

export interface SessionPlayer {
  id: string;
  name: string;
  avatar?: string | null;
  points: number;
  /**
   * Aufgaben überspringen, ohne Gesichtsverlust. Es ist eine Spielressource,
   * keine Kapitulation — und der wichtigste Baustein gegen Trinkdruck.
   */
  jokers: number;
}

export interface ActiveRule {
  id: string;
  /** Welches Spiel die Regel in die Runde gebracht hat. */
  source: string;
  name: string;
  desc: string;
  /** In welchem Akt sie gezogen wurde. */
  act: number;
}

/**
 * Eine persönliche Auflage mit Laufzeit („bis zum Ende des Aktes darfst du
 * niemanden beim Vornamen nennen").
 *
 * Das stärkste Bindeglied zwischen zwei sonst unabhängigen Minispielen: der
 * Fluch überlebt den Spielwechsel, also bleibt die Runde eine Runde und wird
 * nicht zu einer Kette von Einzelspielen.
 */
export interface StatusEffect {
  id: string;
  playerId: string;
  text: string;
  /** Gilt bis einschließlich zu diesem Akt. */
  untilAct: number;
  kind: "fluch" | "segen";
}

/**
 * Was die Runde über eine Person gelernt hat.
 *
 * Daraus entstehen Titel („3× gewählt: Der Verdächtige"), und Titel machen
 * Karten adressierbar: „Der Verdächtige zieht diese Karte." Damit hört das
 * Spiel auf, anonyme Prompts zu werfen, und fängt an, auf die konkrete Gruppe
 * zu zeigen.
 */
export interface DossierEntry {
  id: string;
  playerId: string;
  kind: string;
  text: string;
  act: number;
}

/** Titel, die aus dem Dossier entstehen. Schwelle = wie oft es passiert sein muss. */
const TITLES: { kind: string; count: number; title: string }[] = [
  { kind: "gewaehlt", count: 3, title: "Der Verdächtige" },
  { kind: "zugegeben", count: 3, title: "Das offene Buch" },
  { kind: "verweigert", count: 2, title: "Die Unbestechliche" },
  { kind: "gewonnen", count: 3, title: "Der Glückspilz" },
  { kind: "geplatzt", count: 2, title: "Die Zündschnur" },
];

interface NightState {
  active: boolean;
  players: SessionPlayer[];
  rounds: number;
  activeRules: ActiveRule[];
  /** In welchen Akten die Wasserrunde schon lief — je Akt nur einmal. */
  waterRoundsUsed: number[];
  /** Wer ist dran. Reihum, damit niemand vergessen wird. */
  turnIndex: number;
  effects: StatusEffect[];
  dossier: DossierEntry[];
}

const EMPTY: NightState = {
  active: false,
  players: [],
  rounds: 0,
  activeRules: [],
  waterRoundsUsed: [],
  turnIndex: 0,
  effects: [],
  dossier: [],
};

function actForRounds(rounds: number): number {
  if (rounds >= ACT_THRESHOLDS[2]) return 3;
  if (rounds >= ACT_THRESHOLDS[1]) return 2;
  return 1;
}

interface NightSessionApi {
  active: boolean;
  players: SessionPlayer[];
  rounds: number;
  act: number;
  actLabel: string;
  multiplier: number;
  activeRules: ActiveRule[];
  leader: SessionPlayer | null;
  waterRoundAvailable: boolean;
  /** Wer gerade dran ist. null, wenn keine Session läuft. */
  currentPlayer: SessionPlayer | null;
  /** Reihum weiterschalten. */
  nextTurn: () => void;
  begin: (players: { id: string; name: string; avatar?: string | null }[]) => void;
  end: () => void;
  /** Punkte inklusive Akt-Multiplikator. Gibt die tatsächlich vergebenen zurück. */
  award: (playerId: string, base: number) => number;
  awardAll: (base: number) => void;
  /** false, wenn keine Joker mehr da sind. */
  useJoker: (playerId: string) => boolean;
  addRule: (rule: Omit<ActiveRule, "id" | "act">) => void;
  removeRule: (id: string) => void;
  /** Eine gespielte Runde. Schaltet bei Bedarf den Akt weiter. */
  countRound: () => void;
  /** Alle trinken ein Wasser, alle bekommen einen Joker. Einmal pro Akt. */
  waterRound: () => boolean;

  /** Noch laufende Auflagen — abgelaufene sind schon herausgefiltert. */
  effects: StatusEffect[];
  effectsFor: (playerId: string) => StatusEffect[];
  /** `actsLasting` = wie viele Akte die Auflage gilt (Standard: bis Aktende). */
  addEffect: (playerId: string, text: string, kind?: "fluch" | "segen", actsLasting?: number) => void;
  clearEffect: (id: string) => void;

  /** Was die Runde über jemanden gelernt hat. */
  dossier: DossierEntry[];
  remember: (playerId: string, kind: string, text: string) => void;
  /** Verdiente Titel je Spieler-Id. */
  titles: Record<string, string[]>;
  titleFor: (playerId: string) => string | null;
}

const NightSessionContext = createContext<NightSessionApi | null>(null);

export function NightSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NightState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  // Eine angefangene Nacht überlebt das Schließen der App. Wer um halb drei
  // aus Versehen die App killt, will nicht bei null anfangen.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((json) => {
        if (json) setState({ ...EMPTY, ...JSON.parse(json) });
      })
      .catch(() => {
        /* Kein gespeicherter Stand ist kein Fehler. */
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (state.active) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    } else {
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  }, [state, loaded]);

  const act = actForRounds(state.rounds);
  const multiplier = ACT_MULTIPLIER[act] || 1;

  const begin = useCallback((players: { id: string; name: string; avatar?: string | null }[]) => {
    setState({
      active: true,
      rounds: 0,
      activeRules: [],
      waterRoundsUsed: [],
      turnIndex: 0,
      effects: [],
      dossier: [],
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar ?? null,
        points: 0,
        jokers: START_JOKERS,
      })),
    });
  }, []);

  const end = useCallback(() => setState(EMPTY), []);

  const award = useCallback(
    (playerId: string, base: number) => {
      // Multiplikator aus dem aktuellen Render, nicht aus dem setState-
      // Rückruf: der läuft später, und der Aufrufer will die Punktzahl sofort
      // anzeigen können.
      const gained = base * multiplier;
      setState((s) => ({
        ...s,
        players: s.players.map((p) =>
          p.id === playerId ? { ...p, points: p.points + gained } : p
        ),
      }));
      return gained;
    },
    [multiplier]
  );

  const awardAll = useCallback(
    (base: number) => {
      const gained = base * multiplier;
      setState((s) => ({
        ...s,
        players: s.players.map((p) => ({ ...p, points: p.points + gained })),
      }));
    },
    [multiplier]
  );

  const useJoker = useCallback(
    (playerId: string) => {
      const player = state.players.find((p) => p.id === playerId);
      if (!player || player.jokers <= 0) return false;
      setState((s) => ({
        ...s,
        players: s.players.map((p) =>
          p.id === playerId ? { ...p, jokers: Math.max(0, p.jokers - 1) } : p
        ),
      }));
      return true;
    },
    [state.players]
  );

  const addRule = useCallback((rule: Omit<ActiveRule, "id" | "act">) => {
    setState((s) => {
      // Dieselbe Regel nicht zweimal — beim Nachziehen derselben Karte wäre
      // die Leiste sonst voller Dubletten.
      if (s.activeRules.some((r) => r.name === rule.name)) return s;
      return {
        ...s,
        activeRules: [
          ...s.activeRules,
          { ...rule, id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, act: actForRounds(s.rounds) },
        ],
      };
    });
  }, []);

  const removeRule = useCallback((id: string) => {
    setState((s) => ({ ...s, activeRules: s.activeRules.filter((r) => r.id !== id) }));
  }, []);

  const countRound = useCallback(() => {
    setState((s) => ({ ...s, rounds: s.rounds + 1 }));
  }, []);

  const waterRound = useCallback(() => {
    let ok = false;
    setState((s) => {
      const currentAct = actForRounds(s.rounds);
      if (s.waterRoundsUsed.includes(currentAct)) return s;
      ok = true;
      return {
        ...s,
        waterRoundsUsed: [...s.waterRoundsUsed, currentAct],
        players: s.players.map((p) => ({ ...p, jokers: p.jokers + 1 })),
      };
    });
    return ok;
  }, []);

  const nextTurn = useCallback(() => {
    setState((s) =>
      s.players.length === 0
        ? s
        : { ...s, turnIndex: (s.turnIndex + 1) % s.players.length }
    );
  }, []);

  const addEffect = useCallback(
    (playerId: string, text: string, kind: "fluch" | "segen" = "fluch", actsLasting = 1) => {
      setState((s) => ({
        ...s,
        effects: [
          ...s.effects,
          {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            playerId,
            text,
            kind,
            untilAct: actForRounds(s.rounds) + (actsLasting - 1),
          },
        ],
      }));
    },
    []
  );

  const clearEffect = useCallback((id: string) => {
    setState((s) => ({ ...s, effects: s.effects.filter((e) => e.id !== id) }));
  }, []);

  const remember = useCallback((playerId: string, kind: string, text: string) => {
    setState((s) => ({
      ...s,
      dossier: [
        ...s.dossier,
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          playerId,
          kind,
          text,
          act: actForRounds(s.rounds),
        },
      ],
    }));
  }, []);

  // Abgelaufene Auflagen fallen hier heraus, statt beim Aktwechsel gelöscht zu
  // werden: so bleibt der Zustand rein additiv und übersteht ein Neuladen.
  const effects = useMemo(
    () => state.effects.filter((e) => e.untilAct >= act),
    [state.effects, act]
  );

  const titles = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const p of state.players) {
      const meins = state.dossier.filter((d) => d.playerId === p.id);
      const verdient = TITLES.filter(
        (t) => meins.filter((d) => d.kind === t.kind).length >= t.count
      ).map((t) => t.title);
      if (verdient.length) out[p.id] = verdient;
    }
    return out;
  }, [state.dossier, state.players]);

  const leader = useMemo(() => {
    if (state.players.length === 0) return null;
    return [...state.players].sort((a, b) => b.points - a.points)[0];
  }, [state.players]);

  const currentPlayer = state.players.length
    ? state.players[state.turnIndex % state.players.length]
    : null;

  const value: NightSessionApi = {
    active: state.active,
    players: state.players,
    rounds: state.rounds,
    act,
    actLabel: ACT_LABEL[act] || ACT_LABEL[1],
    multiplier,
    activeRules: state.activeRules,
    leader,
    waterRoundAvailable: state.active && !state.waterRoundsUsed.includes(act),
    currentPlayer,
    nextTurn,
    begin,
    end,
    award,
    awardAll,
    useJoker,
    addRule,
    removeRule,
    countRound,
    waterRound,
    effects,
    effectsFor: (playerId: string) => effects.filter((e) => e.playerId === playerId),
    addEffect,
    clearEffect,
    dossier: state.dossier,
    remember,
    titles,
    titleFor: (playerId: string) => (titles[playerId] ? titles[playerId][0] : null),
  };

  return <NightSessionContext.Provider value={value}>{children}</NightSessionContext.Provider>;
}

/**
 * Der Session-Zustand. Gibt null zurück, wenn kein Provider darüber hängt —
 * dann laufen die Spiele wie früher, nur ohne Rahmen.
 */
export function useNightSession(): NightSessionApi | null {
  return useContext(NightSessionContext);
}
