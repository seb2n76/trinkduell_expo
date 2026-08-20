import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { triggerHaptic } from "@/services/haptics";
import { GameShell } from "./GameShell";
import { useThemeColors } from "@/services/theme";

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

type Phase = 0 | 1 | 2 | 3;

const PHASE_INFO: { question: string; options: { key: string; label: string }[] }[] = [
  { question: "Rot oder Schwarz?", options: [{ key: "rot", label: "Rot" }, { key: "schwarz", label: "Schwarz" }] },
  { question: "Höher oder tiefer?", options: [{ key: "hoeher", label: "Höher" }, { key: "tiefer", label: "Tiefer" }] },
  { question: "Innerhalb oder außerhalb?", options: [{ key: "innen", label: "Innerhalb" }, { key: "aussen", label: "Außerhalb" }] },
  { question: "Welche Farbe?", options: SUITS.map((s) => ({ key: s, label: s })) },
];

/**
 * Busfahrer — the classic four-stage guessing round. Get all four right and
 * you're through; guess wrong and you take a sip and start over.
 */
export function Busfahrer({ onCancel, onMinimize }: { onCancel: () => void; onMinimize: () => void }) {
  const c = useThemeColors();
  const [deck, setDeck] = useState<Card[]>(() => freshDeck());
  const [cards, setCards] = useState<Card[]>([]);
  const [phase, setPhase] = useState<Phase>(0);
  const [result, setResult] = useState<"correct" | "wrong" | "won" | null>(null);

  const drawCard = (): [Card, Card[]] => {
    let d = deck.length > 0 ? [...deck] : freshDeck();
    const card = d.pop()!;
    return [card, d];
  };

  const evaluate = (choice: string, card: Card): boolean => {
    switch (phase) {
      case 0:
        return (choice === "rot") === isRed(card);
      case 1:
        return choice === "hoeher" ? card.value > cards[0].value : card.value < cards[0].value;
      case 2: {
        const [lo, hi] = [cards[0].value, cards[1].value].sort((a, b) => a - b);
        const inside = card.value > lo && card.value < hi;
        return choice === "innen" ? inside : !inside;
      }
      case 3:
        return choice === card.suit;
    }
  };

  const choose = (choice: string) => {
    const [card, rest] = drawCard();
    const ok = evaluate(choice, card);

    setDeck(rest);
    setCards((c) => [...c, card]);
    triggerHaptic(ok ? "success" : "error");

    if (!ok) {
      setResult("wrong");
    } else if (phase === 3) {
      setResult("won");
    } else {
      setResult("correct");
    }
  };

  const continueGame = () => {
    triggerHaptic("light");
    if (result === "correct") {
      setPhase((p) => (p + 1) as Phase);
      setResult(null);
      return;
    }
    // Nach Sieg oder Fehler: neue Runde für die nächste Person
    setCards([]);
    setPhase(0);
    setResult(null);
  };

  return (
    <GameShell title="Busfahrer" accent={ACCENT} onCancel={onCancel} onMinimize={onMinimize}>
      <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-4">
        Stufe {phase + 1} von 4
      </Text>

      {/* Aufgedeckte Karten */}
      <View className="flex-row justify-center flex-wrap mb-6">
        {cards.map((karte, i) => (
          <View
            key={i}
            className="bg-surface border border-line rounded-2xl w-16 h-24 items-center justify-center mx-1 mb-2"
          >
            <Text
              style={{ color: isRed(karte) ? c.danger : c.content }}
              className="text-2xl font-black"
            >
              {karte.label}
            </Text>
            <Text style={{ color: isRed(karte) ? c.danger : c.content }} className="text-lg">
              {karte.suit}
            </Text>
          </View>
        ))}
        {cards.length === 0 && (
          <View className="bg-surface/40 border border-dashed border-line rounded-2xl w-16 h-24 items-center justify-center">
            <Text className="text-content-faint text-2xl">?</Text>
          </View>
        )}
      </View>

      <View className="flex-1 justify-center">
        {result === null ? (
          <>
            <Text className="text-content text-lg font-black text-center mb-6">
              {PHASE_INFO[phase].question}
            </Text>
            <View className="flex-row flex-wrap justify-center">
              {PHASE_INFO[phase].options.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => choose(opt.key)}
                  style={{ borderColor: ACCENT }}
                  className="bg-surface border-2 rounded-2xl px-6 py-4 m-1.5 min-w-[110px] items-center active:scale-95"
                >
                  <Text className="text-content text-sm font-black">{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <View className="items-center">
            <Text className="text-5xl mb-4">
              {result === "won" ? "🎉" : result === "correct" ? "✅" : "🍻"}
            </Text>
            <Text
              style={{ color: result === "wrong" ? c.danger : ACCENT }}
              className="text-xl font-black text-center mb-2"
            >
              {result === "won"
                ? "Durchgekommen!"
                : result === "correct"
                ? "Richtig — weiter!"
                : "Daneben!"}
            </Text>
            <Text className="text-content-muted text-xs font-bold text-center leading-relaxed px-6">
              {result === "won"
                ? "Du bist durch und darfst einen Schluck verteilen. Nächste Person ist dran."
                : result === "correct"
                ? "Eine Stufe geschafft. Weiter geht's."
                : "Nimm einen Schluck — dann ist die nächste Person dran."}
            </Text>

            <TouchableOpacity
              onPress={continueGame}
              style={{ backgroundColor: ACCENT }}
              className="mt-8 px-8 py-4 rounded-2xl active:scale-95"
            >
              <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                {result === "correct" ? "Nächste Stufe" : "Nächste Person"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </GameShell>
  );
}

export default Busfahrer;
