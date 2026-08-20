import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { triggerHaptic } from "@/services/haptics";
import { GameShell } from "./GameShell";
import { useNightSession } from "@/games/session";

// Kennfarbe des Spiels — Identitaet, kein semantischer UI-Ton. Steht auf
// Modulebene und wird deshalb nicht aus dem Theme gezogen.
const ACCENT = "#34d399";

export interface Card {
  suit: "♥" | "♦" | "♣" | "♠";
  value: number;
  label: string;
}

const SUITS: Card["suit"][] = ["♥", "♦", "♣", "♠"];
const VALUES = [
  { value: 2, label: "2" }, { value: 3, label: "3" }, { value: 4, label: "4" },
  { value: 5, label: "5" }, { value: 6, label: "6" }, { value: 7, label: "7" },
  { value: 8, label: "8" }, { value: 9, label: "9" }, { value: 10, label: "10" },
  { value: 11, label: "J" }, { value: 12, label: "Q" }, { value: 13, label: "K" },
  { value: 14, label: "A" },
];

function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const v of VALUES) deck.push({ suit, value: v.value, label: v.label });
  }
  return deck.sort(() => Math.random() - 0.5);
}

const isRed = (c: Card) => c.suit === "♥" || c.suit === "♦";

/** Die vier Fragen der Austeilrunde, in genau dieser Reihenfolge. */
const FRAGEN: { question: string; options: { key: string; label: string }[] }[] = [
  { question: "Rot oder Schwarz?", options: [{ key: "rot", label: "Rot" }, { key: "schwarz", label: "Schwarz" }] },
  { question: "Höher oder tiefer?", options: [{ key: "hoeher", label: "Höher" }, { key: "tiefer", label: "Tiefer" }] },
  { question: "Innerhalb oder außerhalb?", options: [{ key: "innen", label: "Innerhalb" }, { key: "aussen", label: "Außerhalb" }] },
  { question: "Welche Farbe?", options: SUITS.map((s) => ({ key: s, label: s })) },
];

/** Pyramidenzeilen von unten nach oben. Der Index ist der Schluckwert. */
const PYRAMIDE_ZEILEN = [5, 4, 3, 2, 1];

type Phase = "fragen" | "pyramide" | "fahrt" | "ende";
type Fahrt = 0 | 1 | 2 | 3;

interface Hand {
  playerId: string;
  cards: Card[];
  /** Karten, die in der Pyramide schon abgelegt wurden. */
  spent: number[];
}

/**
 * Busfahrer — vollständig, mit allen drei Phasen.
 *
 * Bis August 2026 war nur die Busfahrt implementiert: vier Stufen raten, bei
 * einem Fehler von vorn. Das ist die SCHLUSSPHASE des Spiels. Es fehlten die
 * beiden Phasen davor — die Austeilrunde, in der jeder vier Karten erspielt,
 * und die Pyramide, in der Schlucke verteilt werden und sich entscheidet, wer
 * am Ende überhaupt fahren muss.
 *
 * Genau diese Phasen tragen die Spannung: Wer in der Pyramide seine Karten
 * loswird, muss nicht fahren. Die Busfahrt allein ist nur eine Ratefolge.
 */
export function Busfahrer({
  onCancel,
  onMinimize,
}: {
  onCancel: () => void;
  onMinimize: () => void;
}) {
  const session = useNightSession();
  // Stabile Referenz: `session?.players || []` waere bei jedem Render ein
  // neues Array und wuerde die Memos darunter jedes Mal neu rechnen lassen.
  const players = useMemo(() => session?.players || [], [session?.players]);
  const hatRunde = !!session?.active && players.length >= 2;

  const [deck, setDeck] = useState<Card[]>(() => freshDeck());
  const [phase, setPhase] = useState<Phase>("fragen");

  // ── Austeilrunde ─────────────────────────────────────────────────────────
  const [hands, setHands] = useState<Hand[]>(() =>
    players.map((p) => ({ playerId: p.id, cards: [], spent: [] }))
  );
  const [spielerIdx, setSpielerIdx] = useState(0);
  const [frageIdx, setFrageIdx] = useState(0);
  const [letzteAntwort, setLetzteAntwort] = useState<"richtig" | "falsch" | null>(null);

  // ── Pyramide ─────────────────────────────────────────────────────────────
  const [pyramide, setPyramide] = useState<{ card: Card; wert: number }[]>([]);
  const [pyramidenIdx, setPyramidenIdx] = useState(0);
  const [aufgedeckt, setAufgedeckt] = useState(false);

  // ── Busfahrt ─────────────────────────────────────────────────────────────
  const [fahrer, setFahrer] = useState<string | null>(null);
  const [fahrtKarten, setFahrtKarten] = useState<Card[]>([]);
  const [fahrtStufe, setFahrtStufe] = useState<Fahrt>(0);
  const [fahrtErgebnis, setFahrtErgebnis] = useState<"correct" | "wrong" | "won" | null>(null);

  // Die Session kommt asynchron aus dem Speicher, das Modal ist aber schon
  // gemountet. Ohne diesen Abgleich bliebe `hands` leer, wenn die Spieler
  // erst nach dem ersten Render eintreffen — und die Austeilrunde zeigte
  // dauerhaft nichts an.
  useEffect(() => {
    if (phase !== "fragen" || spielerIdx !== 0 || frageIdx !== 0) return;
    if (players.length === 0 || hands.length === players.length) return;
    setHands(players.map((p) => ({ playerId: p.id, cards: [], spent: [] })));
  }, [players, hands.length, phase, spielerIdx, frageIdx]);

  const aktuellerSpieler = players[spielerIdx] || null;
  const meineHand = hands.find((h) => h.playerId === aktuellerSpieler?.id) || null;

  const ziehen = (): Card => {
    let d = deck.length > 0 ? [...deck] : freshDeck();
    const card = d.pop()!;
    setDeck(d);
    return card;
  };

  /** Eine Antwort in der Austeilrunde. */
  const antworten = (key: string) => {
    if (!meineHand || !aktuellerSpieler) return;
    const karte = ziehen();
    const bisher = meineHand.cards;
    let richtig = false;

    switch (frageIdx) {
      case 0:
        richtig = (key === "rot") === isRed(karte);
        break;
      case 1:
        richtig =
          (key === "hoeher" && karte.value > bisher[0].value) ||
          (key === "tiefer" && karte.value < bisher[0].value);
        break;
      case 2: {
        const min = Math.min(bisher[0].value, bisher[1].value);
        const max = Math.max(bisher[0].value, bisher[1].value);
        const drin = karte.value > min && karte.value < max;
        richtig = (key === "innen") === drin;
        break;
      }
      case 3:
        richtig = key === karte.suit;
        break;
    }

    triggerHaptic(richtig ? "success" : "error");
    setLetzteAntwort(richtig ? "richtig" : "falsch");
    setHands((hs) =>
      hs.map((h) =>
        h.playerId === aktuellerSpieler.id ? { ...h, cards: [...h.cards, karte] } : h
      )
    );
    if (session && richtig) session.award(aktuellerSpieler.id, 8);
  };

  const weiterNachAntwort = () => {
    setLetzteAntwort(null);
    if (frageIdx < 3) {
      setFrageIdx((f) => (f + 1));
      return;
    }
    // Nächster Spieler, oder ab in die Pyramide.
    setFrageIdx(0);
    if (spielerIdx < players.length - 1) {
      setSpielerIdx((i) => i + 1);
      return;
    }
    bauePyramide();
  };

  const bauePyramide = () => {
    triggerHaptic("medium");
    const karten: { card: Card; wert: number }[] = [];
    let d = [...deck];
    PYRAMIDE_ZEILEN.forEach((anzahl, zeile) => {
      for (let i = 0; i < anzahl; i++) {
        if (d.length === 0) d = freshDeck();
        karten.push({ card: d.pop()!, wert: zeile + 1 });
      }
    });
    setDeck(d);
    setPyramide(karten);
    setPyramidenIdx(0);
    setAufgedeckt(false);
    setPhase("pyramide");
    session?.countRound();
  };

  const aktuellePyramidenkarte = pyramide[pyramidenIdx] || null;

  /**
   * Jemand behauptet, die aufgedeckte Karte zu haben, und legt ab.
   *
   * Abgelegt wird IMMER — genau wie am Tisch, wo die Karte verdeckt auf den
   * Stapel wandert. Ob sie wirklich gepasst hat, kontrolliert die Runde, nicht
   * die App: das ist der Bluff, und ohne ihn wäre die Pyramide nur Buchhaltung.
   * Bevorzugt wandert eine passende Karte weg, sonst irgendeine.
   */
  const kartenAblegen = (playerId: string) => {
    if (!aktuellePyramidenkarte) return;
    triggerHaptic("heavy");
    setHands((hs) =>
      hs.map((h) => {
        if (h.playerId !== playerId) return h;
        const passend = h.cards.findIndex(
          (k, i) => k.value === aktuellePyramidenkarte.card.value && !h.spent.includes(i)
        );
        const idx =
          passend >= 0 ? passend : h.cards.findIndex((_, i) => !h.spent.includes(i));
        return idx >= 0 ? { ...h, spent: [...h.spent, idx] } : h;
      })
    );
    if (session) session.award(playerId, aktuellePyramidenkarte.wert * 4);
  };

  const naechstePyramidenkarte = () => {
    if (pyramidenIdx >= pyramide.length - 1) {
      bestimmeFahrer();
      return;
    }
    setPyramidenIdx((i) => i + 1);
    setAufgedeckt(false);
  };

  /** Wer die meisten Karten übrig hat, fährt den Bus. */
  const bestimmeFahrer = () => {
    triggerHaptic("heavy");
    let schlechteste: Hand | null = null;
    let maxUebrig = -1;
    for (const h of hands) {
      const uebrig = h.cards.length - h.spent.length;
      if (uebrig > maxUebrig) {
        maxUebrig = uebrig;
        schlechteste = h;
      }
    }
    setFahrer(schlechteste ? schlechteste.playerId : players[0]?.id || null);
    setFahrtKarten([]);
    setFahrtStufe(0);
    setFahrtErgebnis(null);
    setPhase("fahrt");
  };

  // ── Busfahrt: die vier Stufen ────────────────────────────────────────────
  const fahrtAntwort = (key: string) => {
    const karte = ziehen();
    let richtig = false;
    switch (fahrtStufe) {
      case 0:
        richtig = (key === "rot") === isRed(karte);
        break;
      case 1:
        richtig =
          (key === "hoeher" && karte.value > fahrtKarten[0].value) ||
          (key === "tiefer" && karte.value < fahrtKarten[0].value);
        break;
      case 2: {
        const min = Math.min(fahrtKarten[0].value, fahrtKarten[1].value);
        const max = Math.max(fahrtKarten[0].value, fahrtKarten[1].value);
        const drin = karte.value > min && karte.value < max;
        richtig = (key === "innen") === drin;
        break;
      }
      case 3:
        richtig = key === karte.suit;
        break;
    }

    triggerHaptic(richtig ? "success" : "error");
    setFahrtKarten((k) => [...k, karte]);
    if (richtig) {
      setFahrtErgebnis(fahrtStufe === 3 ? "won" : "correct");
      if (fahrtStufe === 3 && session && fahrer) session.award(fahrer, 50);
    } else {
      setFahrtErgebnis("wrong");
    }
  };

  const fahrtWeiter = () => {
    if (fahrtErgebnis === "won") {
      setPhase("ende");
      return;
    }
    if (fahrtErgebnis === "correct") {
      setFahrtStufe((s) => (s + 1) as Fahrt);
      setFahrtErgebnis(null);
      return;
    }
    // Falsch: von vorn.
    setFahrtKarten([]);
    setFahrtStufe(0);
    setFahrtErgebnis(null);
  };

  const neuesSpiel = () => {
    setDeck(freshDeck());
    setHands(players.map((p) => ({ playerId: p.id, cards: [], spent: [] })));
    setSpielerIdx(0);
    setFrageIdx(0);
    setLetzteAntwort(null);
    setPyramide([]);
    setPyramidenIdx(0);
    setFahrer(null);
    setFahrtKarten([]);
    setFahrtStufe(0);
    setFahrtErgebnis(null);
    setPhase("fragen");
  };

  const fahrerName = players.find((p) => p.id === fahrer)?.name || "";

  const restKarten = useMemo(
    () =>
      hands.map((h) => ({
        name: players.find((p) => p.id === h.playerId)?.name || "?",
        uebrig: h.cards.length - h.spent.length,
      })),
    [hands, players]
  );

  const karteAnzeigen = (karte: Card, gross = false) => (
    <View
      className={`bg-surface border-2 border-line rounded-2xl items-center justify-center ${
        gross ? "w-24 h-32" : "w-14 h-20"
      }`}
    >
      <Text
        className={`font-black ${gross ? "text-2xl" : "text-base"} ${
          isRed(karte) ? "text-danger" : "text-content"
        }`}
      >
        {karte.label}
      </Text>
      <Text
        className={`${gross ? "text-3xl" : "text-lg"} ${
          isRed(karte) ? "text-danger" : "text-content-muted"
        }`}
      >
        {karte.suit}
      </Text>
    </View>
  );

  if (!hatRunde) {
    return (
      <GameShell title="Busfahrer" accent={ACCENT} onCancel={onCancel} onMinimize={onMinimize}>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-content text-base font-black text-center mb-2">
            Busfahrer braucht eine Runde
          </Text>
          <Text className="text-content-faint text-xs font-medium text-center leading-relaxed">
            Trag mindestens zwei Leute in die Lobby ein — das Spiel verteilt
            Karten an alle und braucht dafür Namen.
          </Text>
        </View>
      </GameShell>
    );
  }

  return (
    <GameShell title="Busfahrer" accent={ACCENT} onCancel={onCancel} onMinimize={onMinimize}>
      {/* Phasenanzeige */}
      <View className="flex-row justify-center mb-4" style={{ gap: 6 }}>
        {[
          { key: "fragen", label: "1 · Austeilen" },
          { key: "pyramide", label: "2 · Pyramide" },
          { key: "fahrt", label: "3 · Busfahrt" },
        ].map((p) => {
          const aktiv = phase === p.key || (phase === "ende" && p.key === "fahrt");
          return (
            <View
              key={p.key}
              style={aktiv ? { borderColor: ACCENT } : undefined}
              className={`px-2.5 py-1 rounded-lg border ${
                aktiv ? "bg-accent/10" : "bg-surface border-line opacity-50"
              }`}
            >
              <Text
                style={aktiv ? { color: ACCENT } : undefined}
                className={`text-[9px] font-black uppercase tracking-wider ${
                  aktiv ? "" : "text-content-faint"
                }`}
              >
                {p.label}
              </Text>
            </View>
          );
        })}
      </View>

      {phase === "fragen" && aktuellerSpieler && meineHand && (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-1">
            Karte {frageIdx + 1} von 4
          </Text>
          <Text className="text-content text-lg font-black text-center mb-4">
            {aktuellerSpieler.name} ist dran
          </Text>

          {meineHand.cards.length > 0 && (
            <View className="flex-row justify-center mb-4" style={{ gap: 8 }}>
              {meineHand.cards.map((k, i) => (
                <View key={i}>{karteAnzeigen(k)}</View>
              ))}
            </View>
          )}

          {letzteAntwort ? (
            <View className="items-center">
              <Text className="text-5xl mb-3">{letzteAntwort === "richtig" ? "✅" : "🍻"}</Text>
              <Text
                className={`text-base font-black text-center mb-2 ${
                  letzteAntwort === "richtig" ? "text-success" : "text-danger"
                }`}
              >
                {letzteAntwort === "richtig" ? "Richtig! +8 Punkte" : "Daneben — ein Schluck"}
              </Text>
              <Text className="text-content-faint text-[11px] font-medium text-center mb-5 px-6">
                {letzteAntwort === "falsch"
                  ? "Oder eben nicht — Wasser zählt genauso. Die Karte bleibt trotzdem liegen."
                  : "Die Karte bleibt vor dir liegen. Je mehr du am Ende noch hast, desto eher fährst du."}
              </Text>
              <TouchableOpacity
                onPress={weiterNachAntwort}
                style={{ backgroundColor: ACCENT }}
                className="w-full py-4 rounded-2xl items-center active:scale-95"
              >
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                  Weiter
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text className="text-content text-base font-black text-center mb-4">
                {FRAGEN[frageIdx].question}
              </Text>
              <View className="flex-row flex-wrap justify-center" style={{ gap: 10 }}>
                {FRAGEN[frageIdx].options.map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => antworten(opt.key)}
                    className="bg-surface border border-line px-6 py-4 rounded-2xl active:scale-95"
                  >
                    <Text className="text-content font-black text-sm">{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <View className="h-6" />
        </ScrollView>
      )}

      {phase === "pyramide" && aktuellePyramidenkarte && (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-1">
            Karte {pyramidenIdx + 1} von {pyramide.length}
          </Text>
          <Text className="text-content text-base font-black text-center mb-4">
            {aktuellePyramidenkarte.wert} {aktuellePyramidenkarte.wert === 1 ? "Schluck" : "Schlucke"}
          </Text>

          <View className="items-center mb-5">
            {aufgedeckt ? (
              karteAnzeigen(aktuellePyramidenkarte.card, true)
            ) : (
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("medium");
                  setAufgedeckt(true);
                }}
                style={{ borderColor: ACCENT }}
                className="w-24 h-32 bg-surface border-2 rounded-2xl items-center justify-center active:scale-95"
              >
                <Text className="text-3xl">🂠</Text>
                <Text className="text-content-faint text-[9px] font-black uppercase mt-1">
                  Aufdecken
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {aufgedeckt && (
            <>
              <Text className="text-content-faint text-[11px] font-bold text-center mb-3 px-4">
                Wer diese Karte hat, legt sie ab und verteilt{" "}
                {aktuellePyramidenkarte.wert}{" "}
                {aktuellePyramidenkarte.wert === 1 ? "Schluck" : "Schlucke"}. Bluffen
                ist erlaubt — die Runde kontrolliert, nicht die App.
              </Text>
              <View className="flex-row flex-wrap justify-center mb-5" style={{ gap: 8 }}>
                {hands.map((h) => {
                  const name = players.find((p) => p.id === h.playerId)?.name || "?";
                  const uebrig = h.cards.length - h.spent.length;
                  return (
                    <TouchableOpacity
                      key={h.playerId}
                      onPress={() => kartenAblegen(h.playerId)}
                      disabled={uebrig === 0}
                      className={`px-3.5 py-2.5 rounded-xl border ${
                        uebrig === 0
                          ? "bg-bg border-line opacity-40"
                          : "bg-surface border-line"
                      }`}
                    >
                      <Text className="text-content text-xs font-black">{name}</Text>
                      <Text className="text-content-faint text-[9px] font-bold text-center">
                        {uebrig} übrig
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                onPress={naechstePyramidenkarte}
                style={{ backgroundColor: ACCENT }}
                className="w-full py-4 rounded-2xl items-center active:scale-95"
              >
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                  {pyramidenIdx >= pyramide.length - 1 ? "Wer fährt den Bus?" : "Nächste Karte"}
                </Text>
              </TouchableOpacity>
            </>
          )}
          <View className="h-6" />
        </ScrollView>
      )}

      {phase === "fahrt" && (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-1">
            Stufe {fahrtStufe + 1} von 4
          </Text>
          <Text className="text-content text-lg font-black text-center mb-1">
            🚌 {fahrerName} fährt den Bus
          </Text>
          <Text className="text-content-faint text-[11px] font-medium text-center mb-4 px-6">
            Die meisten Karten übrig — Pech gehabt. Vier Stufen am Stück, sonst
            von vorn.
          </Text>

          {fahrtKarten.length > 0 && (
            <View className="flex-row justify-center mb-4" style={{ gap: 8 }}>
              {fahrtKarten.map((k, i) => (
                <View key={i}>{karteAnzeigen(k)}</View>
              ))}
            </View>
          )}

          {fahrtErgebnis ? (
            <View className="items-center">
              <Text className="text-5xl mb-3">
                {fahrtErgebnis === "won" ? "🎉" : fahrtErgebnis === "correct" ? "✅" : "🍻"}
              </Text>
              <Text
                className={`text-base font-black text-center mb-4 ${
                  fahrtErgebnis === "wrong" ? "text-danger" : "text-success"
                }`}
              >
                {fahrtErgebnis === "won"
                  ? "Durch! +50 Punkte"
                  : fahrtErgebnis === "correct"
                    ? "Richtig — weiter"
                    : "Falsch — ein Schluck und von vorn"}
              </Text>
              <TouchableOpacity
                onPress={fahrtWeiter}
                style={{ backgroundColor: ACCENT }}
                className="w-full py-4 rounded-2xl items-center active:scale-95"
              >
                <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                  {fahrtErgebnis === "won" ? "Geschafft" : "Weiter"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text className="text-content text-base font-black text-center mb-4">
                {FRAGEN[fahrtStufe].question}
              </Text>
              <View className="flex-row flex-wrap justify-center" style={{ gap: 10 }}>
                {FRAGEN[fahrtStufe].options.map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => fahrtAntwort(opt.key)}
                    className="bg-surface border border-line px-6 py-4 rounded-2xl active:scale-95"
                  >
                    <Text className="text-content font-black text-sm">{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <View className="h-6" />
        </ScrollView>
      )}

      {phase === "ende" && (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-6xl mb-4">🏁</Text>
          <Text className="text-content text-xl font-black text-center mb-2">
            {fahrerName} ist durchgekommen!
          </Text>
          <View className="bg-surface border border-line rounded-2xl p-4 w-full mb-5">
            <Text className="text-content-faint text-[9px] font-black uppercase tracking-widest mb-2">
              Restkarten am Ende
            </Text>
            {restKarten.map((r) => (
              <View key={r.name} className="flex-row justify-between py-0.5">
                <Text className="text-content text-xs font-bold">{r.name}</Text>
                <Text className="text-content-faint text-xs font-black">{r.uebrig}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            onPress={neuesSpiel}
            style={{ backgroundColor: ACCENT }}
            className="w-full py-4 rounded-2xl items-center active:scale-95"
          >
            <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
              Nochmal
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </GameShell>
  );
}

export default Busfahrer;
