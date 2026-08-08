import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { triggerHaptic } from "@/services/haptics";
import { Avatar } from "@/components/Avatar";
import { GameShell, GameButton } from "./GameShell";
import { Intensity, WHO_WOULD_RATHER, pickRandom } from "@/games/content";

const ACCENT = "#c084fc";

interface Player {
  id: string;
  name: string;
  avatar?: string | null;
}

/**
 * Everyone points at someone; tapping a player records a vote. The player
 * with the most votes drinks. Votes are tallied on the shared device, so
 * this works with a single phone passed around.
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
  const [intensity, setIntensity] = useState<Intensity>("party");
  const [prompt, setPrompt] = useState(() => pickRandom(WHO_WOULD_RATHER.party));
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState(false);

  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const maxVotes = Math.max(0, ...Object.values(votes));
  const winners = players.filter((p) => (votes[p.id] || 0) === maxVotes && maxVotes > 0);

  const vote = (playerId: string) => {
    if (revealed) return;
    triggerHaptic("light");
    setVotes((v) => ({ ...v, [playerId]: (v[playerId] || 0) + 1 }));
  };

  const nextRound = (level: Intensity = intensity) => {
    triggerHaptic("medium");
    setPrompt(pickRandom(WHO_WOULD_RATHER[level], prompt));
    setVotes({});
    setRevealed(false);
  };

  const changeIntensity = (level: Intensity) => {
    setIntensity(level);
    nextRound(level);
  };

  return (
    <GameShell
      title="Wer würde eher?"
      accent={ACCENT}
      onCancel={onCancel}
      onMinimize={onMinimize}
      intensity={intensity}
      onIntensityChange={changeIntensity}
    >
      <View
        style={{ borderColor: ACCENT }}
        className="bg-slate-900 border-2 rounded-3xl p-5 mb-4"
      >
        <Text className="text-white text-base font-black text-center leading-relaxed">{prompt}</Text>
      </View>

      <Text className="text-slate-500 text-[10px] font-black uppercase tracking-widest text-center mb-3">
        {revealed
          ? winners.length > 1
            ? "Gleichstand — alle nehmen einen Schluck"
            : "Ergebnis"
          : `Tippt auf eine Person (${totalVotes}/${players.length} Stimmen)`}
      </Text>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {players.map((p) => {
          const count = votes[p.id] || 0;
          const isWinner = revealed && count === maxVotes && maxVotes > 0;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => vote(p.id)}
              disabled={revealed}
              style={isWinner ? { borderColor: ACCENT } : undefined}
              className={`flex-row items-center p-3 rounded-2xl mb-2 border ${
                isWinner ? "bg-purple-500/15" : "bg-slate-900 border-white/5"
              }`}
            >
              <Avatar uri={p.avatar} name={p.name} size={36} className="border border-white/10" />
              <Text className="text-white text-xs font-black flex-1 ml-3">{p.name}</Text>
              {count > 0 && (
                <View
                  style={{ backgroundColor: ACCENT }}
                  className="px-2.5 py-1 rounded-full"
                >
                  <Text className="text-slate-950 text-[10px] font-black">{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
        <View className="h-4" />
      </ScrollView>

      {revealed ? (
        <GameButton label="Nächste Frage" icon="arrow-forward" accent={ACCENT} onPress={() => nextRound()} />
      ) : (
        <GameButton
          label={totalVotes === 0 ? "Erst abstimmen" : "Auflösen"}
          icon="eye"
          accent={ACCENT}
          disabled={totalVotes === 0}
          onPress={() => {
            triggerHaptic("success");
            setRevealed(true);
          }}
        />
      )}
    </GameShell>
  );
}

export default WhoWouldRather;
