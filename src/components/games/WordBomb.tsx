import React, { useState, useEffect, useRef } from "react";
import { View, Text } from "react-native";
import { triggerHaptic } from "@/services/haptics";
import { GameShell, GameButton } from "./GameShell";
import { WORD_BOMB_CATEGORIES, pickRandom } from "@/games/content";

const ACCENT = "#fb923c";

/**
 * Pass-the-phone word game: a category is shown, players name matching
 * words in turn and tap "Weiter" to hand over. Whoever holds the phone when
 * the hidden timer runs out takes a sip.
 *
 * The countdown length is randomised and never displayed — knowing the exact
 * remaining time removes all the tension.
 */
export function WordBomb({
  onCancel,
  onMinimize,
}: {
  onCancel: () => void;
  onMinimize: () => void;
}) {
  const [category, setCategory] = useState(() => pickRandom(WORD_BOMB_CATEGORIES));
  const [status, setStatus] = useState<"ready" | "running" | "exploded">("ready");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Always clear on unmount, otherwise the "explosion" could fire after the
  // player already left the game.
  useEffect(() => clear, []);

  const start = () => {
    triggerHaptic("medium");
    clear();
    setStatus("running");
    const durationMs = 20000 + Math.random() * 25000; // 20–45s, verdeckt
    timeoutRef.current = setTimeout(() => {
      triggerHaptic("error");
      setStatus("exploded");
    }, durationMs);
  };

  const nextRound = () => {
    clear();
    setCategory(pickRandom(WORD_BOMB_CATEGORIES, category));
    setStatus("ready");
  };

  return (
    <GameShell title="Wortbombe" accent={ACCENT} onCancel={onCancel} onMinimize={onMinimize}>
      <View className="flex-1 items-center justify-center">
        <Text className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3">
          Kategorie
        </Text>

        <View
          style={{ borderColor: status === "exploded" ? "#f43f5e" : ACCENT }}
          className="w-full bg-slate-900 border-2 rounded-3xl p-8 items-center shadow-2xl"
        >
          {status === "exploded" ? (
            <>
              <Text className="text-6xl mb-3">💥</Text>
              <Text className="text-rose-400 text-xl font-black text-center mb-2">
                Bombe geplatzt!
              </Text>
              <Text className="text-slate-400 text-xs font-bold text-center leading-relaxed">
                Wer das Handy hält, nimmt einen Schluck.
              </Text>
            </>
          ) : (
            <>
              <Text className="text-white text-2xl font-black text-center leading-relaxed mb-3">
                {category}
              </Text>
              <Text className="text-slate-400 text-xs font-bold text-center leading-relaxed">
                {status === "running"
                  ? "Nenne ein Wort und gib das Handy weiter!"
                  : "Reihum ein passendes Wort nennen — dann weitergeben."}
              </Text>
            </>
          )}
        </View>

        {status === "running" && (
          <Text className="text-slate-600 text-[10px] font-bold mt-6 text-center">
            Die Zeit läuft — wie lange, weiß niemand.
          </Text>
        )}
      </View>

      {status === "ready" && (
        <GameButton label="Bombe zünden" icon="flame" accent={ACCENT} onPress={start} />
      )}
      {status === "running" && (
        <GameButton
          label="Weitergeben"
          icon="arrow-forward"
          accent={ACCENT}
          onPress={() => triggerHaptic("light")}
        />
      )}
      {status === "exploded" && (
        <GameButton label="Neue Runde" icon="refresh" accent={ACCENT} onPress={nextRound} />
      )}
    </GameShell>
  );
}

export default WordBomb;
