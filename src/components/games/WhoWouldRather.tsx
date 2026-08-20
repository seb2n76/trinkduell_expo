import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { Avatar } from "@/components/Avatar";
import { GameShell, GameButton } from "./GameShell";
import { Intensity, WHO_WOULD_RATHER, pickRandom } from "@/games/content";
import { useNightSession } from "@/games/session";
import { useThemeColors } from "@/services/theme";

// Kennfarbe des Spiels — Identitaet, kein semantischer UI-Ton.
const ACCENT = "#c084fc";

interface Player {
  id: string;
  name: string;
  avatar?: string | null;
}

type Phase = "tippen" | "abstimmen" | "verteidigung" | "ergebnis";

/**
 * „Wer würde eher" mit Tipprunde, Verteidigungsrede und zweiter Abstimmung.
 *
 * Vorher waren das zehn Sekunden: abstimmen, auflösen, weiter. Jetzt legt sich
 * zuerst jeder fest, WEN die Runde wählen wird — das ist der soziale Reiz, denn
 * dafür muss man die Gruppe lesen, nicht die Frage. Wer gewählt wird, bekommt
 * dreißig Sekunden Verteidigung, danach wird noch einmal abgestimmt.
 *
 * Aus zehn Sekunden werden zwei Minuten Gruppendynamik, ohne eine einzige neue
 * Frage schreiben zu müssen.
 */
export function WhoWouldRather({
  players,
  onCancel,
  onMinimize,
}: {
  players: Player[];
  onCancel: () => void;
  onMinimize: () => void;
}) {
  const c = useThemeColors();
  const session = useNightSession();
  const [intensity, setIntensity] = useState<Intensity>("party");
  const [prompt, setPrompt] = useState(() => pickRandom(WHO_WOULD_RATHER.party));
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<Phase>("tippen");
  const [tipps, setTipps] = useState<Record<string, string>>({});
  const [angeklagt, setAngeklagt] = useState<string | null>(null);
  const [zweiteRunde, setZweiteRunde] = useState(false);

  const runde = session?.players?.length ? session.players : players;
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const maxVotes = Math.max(0, ...Object.values(votes));
  const gewinner = runde.filter((p) => (votes[p.id] || 0) === maxVotes && maxVotes > 0);

  const vote = (playerId: string) => {
    if (phase !== "abstimmen") return;
    triggerHaptic("light");
    setVotes((v) => ({ ...v, [playerId]: (v[playerId] || 0) + 1 }));
  };

  /** Tipp: Wen wird die Runde wählen? */
  const tippen = (voterId: string, zielId: string) => {
    triggerHaptic("light");
    setTipps((t) => ({ ...t, [voterId]: zielId }));
  };

  const aufloesen = () => {
    triggerHaptic("success");
    const getroffen = gewinner[0] || null;
    setAngeklagt(getroffen ? getroffen.id : null);

    if (session && getroffen) {
      // Tipps abrechnen — nur in der ersten Abstimmung, sonst gäbe es die
      // Punkte zweimal für dieselbe Vorhersage.
      if (!zweiteRunde) {
        for (const [voterId, zielId] of Object.entries(tipps)) {
          if (zielId === getroffen.id) session.award(voterId, 10);
        }
      }
      session.award(getroffen.id, 5);
      session.remember(getroffen.id, "gewaehlt", `wurde gewählt: „${prompt}"`);
    }

    // Nach der zweiten Abstimmung ist Schluss — sonst dreht sich das ewig.
    setPhase(zweiteRunde ? "ergebnis" : "verteidigung");
  };

  const verteidigungVorbei = () => {
    triggerHaptic("medium");
    setVotes({});
    setZweiteRunde(true);
    setPhase("abstimmen");
  };

  const nextRound = (level: Intensity = intensity) => {
    triggerHaptic("medium");
    setPrompt(pickRandom(WHO_WOULD_RATHER[level], prompt));
    setVotes({});
    setTipps({});
    setAngeklagt(null);
    setZweiteRunde(false);
    setPhase("tippen");
    session?.countRound();
  };

  const changeIntensity = (level: Intensity) => {
    setIntensity(level);
    nextRound(level);
  };

  const angeklagtName = runde.find((p) => p.id === angeklagt)?.name || "";

  return (
    <GameShell
      title="Wer würde eher?"
      accent={ACCENT}
      onCancel={onCancel}
      onMinimize={onMinimize}
      intensity={intensity}
      onIntensityChange={changeIntensity}
    >
      <View style={{ borderColor: ACCENT }} className="bg-surface border-2 rounded-3xl p-5 mb-4">
        <Text className="text-content text-base font-black text-center leading-relaxed">
          {prompt}
        </Text>
      </View>

      {phase === "verteidigung" ? (
        /* Verteidigungsrede: der einzige Moment, in dem eine Person die Runde
           allein bespielt — und der Grund, warum danach noch mal gewählt wird. */
        <View className="flex-1 items-center justify-center">
          <View className="bg-surface border-2 border-warning/50 rounded-3xl p-6 w-full items-center">
            <Ionicons name="megaphone-outline" size={32} color={c.warning} />
            <Text className="text-warning text-[10px] font-black uppercase tracking-widest mt-3 mb-1">
              30 Sekunden Verteidigung
            </Text>
            <Text className="text-content text-lg font-black text-center mb-2">
              {angeklagtName}
            </Text>
            <Text className="text-content-faint text-xs font-medium text-center leading-relaxed">
              Die Runde hat dich gewählt. Rede dich raus — danach wird noch
              einmal abgestimmt. Überzeugst du, trifft es jemand anderen.
            </Text>
          </View>
          <View className="h-4" />
          <GameButton
            label="Fertig — nochmal abstimmen"
            icon="repeat"
            accent={ACCENT}
            onPress={verteidigungVorbei}
          />
        </View>
      ) : (
        <>
          <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-3">
            {phase === "tippen"
              ? `Tippt zuerst: Wen wählt die Runde? (${Object.keys(tipps).length}/${runde.length})`
              : phase === "ergebnis"
                ? gewinner.length > 1
                  ? "Gleichstand — alle Gewählten nehmen einen Schluck"
                  : "Endgültig"
                : zweiteRunde
                  ? `Zweite Abstimmung (${totalVotes}/${runde.length})`
                  : `Jetzt abstimmen (${totalVotes}/${runde.length})`}
          </Text>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {phase === "tippen" ? (
              // Jeder tippt der Reihe nach auf dem geteilten Gerät.
              <View className="gap-2">
                {runde.map((tipper) => {
                  const meinTipp = tipps[tipper.id];
                  return (
                    <View
                      key={tipper.id}
                      className="bg-surface border border-line rounded-2xl p-3"
                    >
                      <Text className="text-content text-xs font-black mb-2">
                        {tipper.name} tippt auf:
                      </Text>
                      <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                        {runde.map((ziel) => {
                          const aktiv = meinTipp === ziel.id;
                          return (
                            <TouchableOpacity
                              key={ziel.id}
                              onPress={() => tippen(tipper.id, ziel.id)}
                              style={aktiv ? { borderColor: ACCENT } : undefined}
                              className={`px-2.5 py-1.5 rounded-lg border ${
                                aktiv ? "bg-accent-2/15" : "bg-bg border-line"
                              }`}
                            >
                              <Text
                                className={`text-[10px] font-black ${
                                  aktiv ? "text-accent-2-ink" : "text-content-muted"
                                }`}
                              >
                                {ziel.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              runde.map((p) => {
                const count = votes[p.id] || 0;
                const isWinner = phase === "ergebnis" && count === maxVotes && maxVotes > 0;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => vote(p.id)}
                    disabled={phase !== "abstimmen"}
                    style={isWinner ? { borderColor: ACCENT } : undefined}
                    className={`flex-row items-center p-3 rounded-2xl mb-2 border ${
                      isWinner ? "bg-accent-2/15" : "bg-surface border-line"
                    }`}
                  >
                    <Avatar uri={p.avatar} name={p.name} size={36} className="border border-line" />
                    <Text className="text-content text-xs font-black flex-1 ml-3">{p.name}</Text>
                    {count > 0 && (
                      <View style={{ backgroundColor: ACCENT }} className="px-2.5 py-1 rounded-full">
                        <Text className="text-on-accent text-[10px] font-black">{count}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
            <View className="h-4" />
          </ScrollView>

          {phase === "tippen" && (
            <GameButton
              label={
                Object.keys(tipps).length < runde.length ? "Erst alle tippen lassen" : "Abstimmen"
              }
              icon="arrow-forward"
              accent={ACCENT}
              disabled={Object.keys(tipps).length < runde.length}
              onPress={() => {
                triggerHaptic("medium");
                setPhase("abstimmen");
              }}
            />
          )}
          {phase === "abstimmen" && (
            <GameButton
              label={totalVotes === 0 ? "Erst abstimmen" : "Auflösen"}
              icon="eye"
              accent={ACCENT}
              disabled={totalVotes === 0}
              onPress={aufloesen}
            />
          )}
          {phase === "ergebnis" && (
            <GameButton
              label="Nächste Frage"
              icon="arrow-forward"
              accent={ACCENT}
              onPress={() => nextRound()}
            />
          )}
        </>
      )}
    </GameShell>
  );
}

export default WhoWouldRather;
