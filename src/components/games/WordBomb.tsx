import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { GameShell, GameButton } from "./GameShell";
import { WORD_BOMB_CATEGORIES, pickRandom } from "@/games/content";
import { useNightSession } from "@/games/session";
import { useThemeColors } from "@/services/theme";

// Kennfarbe des Spiels — Identitaet, kein semantischer UI-Ton.
const ACCENT = "#fb923c";

/**
 * Wortbombe mit Ausscheiden, Einspruch und Duell-Finale.
 *
 * Vorher: Timer läuft ab, wer das Handy hält trinkt, neue Runde — eine flache
 * Schleife ohne Fortschritt. Jetzt scheidet aus, wer die Bombe hält; das Feld
 * wird kleiner, die Kategorien enger, und am Ende stehen sich zwei gegenüber.
 *
 * Dazu der Einspruch: Wer ein Wort für ungültig hält, drückt — das erzeugt die
 * Reibung, die dem Spiel fehlte. Entschieden wird per Zuruf, nicht per UI: bei
 * einem Gerät in der Hand einer Person ist alles andere Umstand.
 */
export function WordBomb({
  onCancel,
  onMinimize,
}: {
  onCancel: () => void;
  onMinimize: () => void;
}) {
  const c = useThemeColors();
  const session = useNightSession();
  const [category, setCategory] = useState(() => pickRandom(WORD_BOMB_CATEGORIES));
  const [status, setStatus] = useState<"ready" | "running" | "exploded" | "duell" | "sieger">(
    "ready"
  );
  const [raus, setRaus] = useState<string[]>([]);
  const [halter, setHalter] = useState<string | null>(null);
  const [sieger, setSieger] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alle = session?.players || [];
  const uebrig = alle.filter((p) => !raus.includes(p.id));
  const hatRunde = !!session?.active && alle.length >= 3;

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
    setHalter(null);
    // In der Endphase wird es enger: kürzere Lunte, wenn nur noch wenige übrig
    // sind. Sonst zieht sich das Duell.
    const kurz = hatRunde && uebrig.length <= 2;
    const durationMs = kurz ? 8000 + Math.random() * 12000 : 20000 + Math.random() * 25000;
    timeoutRef.current = setTimeout(() => {
      triggerHaptic("error");
      setStatus("exploded");
    }, durationMs);
  };

  /** Wer hielt die Bombe? Danach ist er raus. */
  const ausscheiden = (playerId: string) => {
    triggerHaptic("heavy");
    const neuRaus = [...raus, playerId];
    setRaus(neuRaus);
    setHalter(playerId);

    if (session) {
      session.remember(playerId, "geplatzt", "hat die Wortbombe gehalten");
      // Wer überlebt, bekommt Punkte — das belohnt Dranbleiben statt Glück.
      for (const p of alle) {
        if (!neuRaus.includes(p.id)) session.award(p.id, 8);
      }
      session.countRound();
    }

    const rest = alle.filter((p) => !neuRaus.includes(p.id));
    if (rest.length === 1) {
      setSieger(rest[0].id);
      if (session) session.award(rest[0].id, 40);
      setStatus("sieger");
    } else if (rest.length === 2) {
      setStatus("duell");
    } else {
      setStatus("ready");
      setCategory(pickRandom(WORD_BOMB_CATEGORIES, category));
    }
  };

  const nextRound = () => {
    clear();
    setCategory(pickRandom(WORD_BOMB_CATEGORIES, category));
    setStatus("ready");
    setHalter(null);
  };

  const neuesSpiel = () => {
    clear();
    setRaus([]);
    setSieger(null);
    setHalter(null);
    setCategory(pickRandom(WORD_BOMB_CATEGORIES, category));
    setStatus("ready");
  };

  const siegerName = alle.find((p) => p.id === sieger)?.name || "";
  const halterName = alle.find((p) => p.id === halter)?.name || "";

  return (
    <GameShell title="Wortbombe" accent={ACCENT} onCancel={onCancel} onMinimize={onMinimize}>
      {hatRunde && (
        <View className="flex-row flex-wrap justify-center mb-3" style={{ gap: 6 }}>
          {alle.map((p) => {
            const drin = !raus.includes(p.id);
            return (
              <View
                key={p.id}
                className={`px-2.5 py-1 rounded-lg border ${
                  drin ? "bg-surface border-line" : "bg-bg border-line opacity-40"
                }`}
              >
                <Text
                  className={`text-[10px] font-black ${
                    drin ? "text-content" : "text-content-faint line-through"
                  }`}
                >
                  {p.name}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <View className="flex-1 items-center justify-center">
        {status === "sieger" ? (
          <View
            style={{ borderColor: ACCENT }}
            className="w-full bg-surface border-2 rounded-3xl p-8 items-center shadow-2xl"
          >
            <Text className="text-6xl mb-3">🏆</Text>
            <Text className="text-content text-xl font-black text-center mb-2">
              {siegerName} hält bis zum Schluss durch!
            </Text>
            <Text className="text-content-muted text-xs font-bold text-center leading-relaxed">
              +40 Punkte. Alle anderen stoßen darauf an — oder eben nicht.
            </Text>
          </View>
        ) : (
          <>
            <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-3">
              {status === "duell" ? "Duell — nur noch zwei" : "Kategorie"}
            </Text>

            <View
              style={{ borderColor: status === "exploded" ? c.danger : ACCENT }}
              className="w-full bg-surface border-2 rounded-3xl p-8 items-center shadow-2xl"
            >
              {status === "exploded" ? (
                <>
                  <Text className="text-6xl mb-3">💥</Text>
                  <Text className="text-danger text-xl font-black text-center mb-2">
                    Bombe geplatzt!
                  </Text>
                  <Text className="text-content-muted text-xs font-bold text-center leading-relaxed">
                    {hatRunde
                      ? "Wer sie gehalten hat, ist raus. Antippen."
                      : "Wer das Handy hält, nimmt einen Schluck."}
                  </Text>
                </>
              ) : (
                <>
                  <Text className="text-content text-2xl font-black text-center leading-relaxed mb-3">
                    {category}
                  </Text>
                  <Text className="text-content-muted text-xs font-bold text-center leading-relaxed">
                    {status === "running"
                      ? "Nenne ein Wort und gib das Handy weiter!"
                      : status === "duell"
                        ? "Kurze Lunte. Reihum, bis einer kippt."
                        : "Reihum ein passendes Wort nennen — dann weitergeben."}
                  </Text>
                </>
              )}
            </View>

            {status === "running" && (
              <>
                <Text className="text-content-faint text-[10px] font-bold mt-6 text-center">
                  Die Zeit läuft — wie lange, weiß niemand.
                </Text>
                {/* Einspruch: die Reibung, die dem Spiel gefehlt hat. */}
                <TouchableOpacity
                  onPress={() => triggerHaptic("medium")}
                  className="mt-3 px-4 py-2 rounded-xl border border-warning/40 bg-warning/10 flex-row items-center"
                >
                  <Ionicons name="hand-left-outline" size={14} color={c.warning} />
                  <Text className="text-warning text-[10px] font-black uppercase tracking-wider ml-1.5">
                    Einspruch — das gilt nicht!
                  </Text>
                </TouchableOpacity>
                <Text className="text-content-faint text-[9px] font-medium mt-1.5 text-center px-6">
                  Die Runde entscheidet per Zuruf. Wer verliert, nimmt einen Schluck.
                </Text>
              </>
            )}

            {/* Wer hielt die Bombe? */}
            {status === "exploded" && hatRunde && (
              <View className="w-full mt-5">
                <View className="flex-row flex-wrap justify-center" style={{ gap: 8 }}>
                  {uebrig.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => ausscheiden(p.id)}
                      className="px-3.5 py-2.5 rounded-xl border border-danger/40 bg-danger/10"
                    >
                      <Text className="text-danger text-xs font-black">{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {halter && status !== "exploded" && (
              <Text className="text-content-faint text-[11px] font-bold mt-4 text-center">
                {halterName} ist raus.
              </Text>
            )}
          </>
        )}
      </View>

      {status === "ready" && (
        <GameButton label="Bombe zünden" icon="flame" accent={ACCENT} onPress={start} />
      )}
      {status === "duell" && (
        <GameButton label="Duell starten" icon="flash" accent={ACCENT} onPress={start} />
      )}
      {status === "running" && (
        <GameButton
          label="Weitergeben"
          icon="arrow-forward"
          accent={ACCENT}
          onPress={() => triggerHaptic("light")}
        />
      )}
      {status === "exploded" && !hatRunde && (
        <GameButton label="Neue Runde" icon="refresh" accent={ACCENT} onPress={nextRound} />
      )}
      {status === "sieger" && (
        <GameButton label="Neues Spiel" icon="refresh" accent={ACCENT} onPress={neuesSpiel} />
      )}
    </GameShell>
  );
}

export default WordBomb;
