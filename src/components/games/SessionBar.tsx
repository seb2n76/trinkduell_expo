import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { useThemeColors } from "@/services/theme";
import { useNightSession } from "@/games/session";

/**
 * Der Kopf der laufenden Nacht: Akt, Punktestand, aktive Regeln, Joker.
 *
 * Liegt über ALLEN lokalen Spielen, nicht in einem einzelnen. Genau das ist
 * der Punkt: Was die Pass-the-Phone-Spiele über eine halbe Stunde trägt, ist
 * Zustand, der den Spielwechsel überlebt. Wer nach vier Karten „Ich hab noch
 * nie" auf Wortbombe wechselt, nimmt Punkte, Regeln und Joker mit.
 */
export function SessionBar() {
  const c = useThemeColors();
  const session = useNightSession();
  const [expanded, setExpanded] = useState(false);

  if (!session || !session.active) return null;

  const { act, actLabel, multiplier, activeRules, leader, players, waterRoundAvailable } = session;

  return (
    <View className="mb-3">
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          triggerHaptic("light");
          setExpanded(!expanded);
        }}
        className="bg-surface border border-line rounded-2xl px-3 py-2.5 flex-row items-center justify-between"
      >
        <View className="flex-row items-center flex-1 mr-2">
          <View className="bg-accent/15 border border-accent/40 px-2 py-0.5 rounded-lg mr-2">
            <Text className="text-accent text-[9px] font-black uppercase tracking-wider">
              {actLabel}
            </Text>
          </View>
          {multiplier > 1 && (
            <View className="bg-warning/20 px-1.5 py-0.5 rounded-md mr-2">
              <Text className="text-warning text-[9px] font-black">×{multiplier}</Text>
            </View>
          )}
          {activeRules.length > 0 && (
            <View className="flex-row items-center">
              <Ionicons name="hammer-outline" size={12} color={c.contentFaint} />
              <Text className="text-content-faint text-[9px] font-black ml-1">
                {activeRules.length} Regeln
              </Text>
            </View>
          )}
        </View>

        <View className="flex-row items-center">
          {leader && leader.points > 0 && (
            <Text className="text-content text-[10px] font-black mr-2" numberOfLines={1}>
              👑 {leader.name} · {leader.points}
            </Text>
          )}
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={c.contentFaint}
          />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View className="bg-surface border border-line border-t-0 rounded-b-2xl px-3 pb-3 -mt-1 pt-2">
          {/* Punktestand */}
          <Text className="text-content-faint text-[9px] font-black uppercase tracking-widest mb-1.5">
            Punktestand
          </Text>
          <View className="gap-1 mb-3">
            {[...players]
              .sort((a, b) => b.points - a.points)
              .map((p) => (
                <View key={p.id} className="flex-row items-center justify-between">
                  <Text className="text-content text-[11px] font-bold flex-1 mr-2" numberOfLines={1}>
                    {p.name}
                  </Text>
                  <View className="flex-row items-center">
                    {/* Joker sichtbar machen. Wer weiß, dass er zwei hat,
                        benutzt sie auch — statt sich zu etwas zu überwinden. */}
                    <Text className="text-content-faint text-[10px] font-bold mr-2">
                      {"🃏".repeat(p.jokers) || "—"}
                    </Text>
                    <Text className="text-content text-[11px] font-black">{p.points}</Text>
                  </View>
                </View>
              ))}
          </View>

          {/* Aktive Regeln — der Grund, warum es nach 20 Minuten eskaliert */}
          {activeRules.length > 0 && (
            <>
              <Text className="text-content-faint text-[9px] font-black uppercase tracking-widest mb-1.5">
                Diese Regeln gelten
              </Text>
              <ScrollView className="max-h-[160px] mb-3" showsVerticalScrollIndicator={false}>
                <View className="gap-1.5">
                  {activeRules.map((rule) => (
                    <View key={rule.id} className="bg-bg border border-line rounded-xl px-2.5 py-2">
                      <View className="flex-row items-center justify-between mb-0.5">
                        <Text className="text-content text-[11px] font-black flex-1 mr-2">
                          {rule.name}
                        </Text>
                        <Text className="text-content-faint text-[8px] font-bold">
                          seit Akt {rule.act}
                        </Text>
                      </View>
                      <Text className="text-content-faint text-[10px] font-medium leading-relaxed">
                        {rule.desc}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </>
          )}

          {/* Wasserrunde: Hydration ist hier ein Spielvorteil, keine Ausrede. */}
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={!waterRoundAvailable}
            onPress={() => {
              if (session.waterRound()) triggerHaptic("success");
            }}
            className={`py-2.5 rounded-xl items-center justify-center flex-row border ${
              waterRoundAvailable ? "bg-success/10 border-success/40" : "bg-bg border-line opacity-50"
            }`}
          >
            <Ionicons
              name="water-outline"
              size={14}
              color={waterRoundAvailable ? c.success : c.contentFaint}
            />
            <Text
              className={`text-[10px] font-black uppercase tracking-wider ml-1.5 ${
                waterRoundAvailable ? "text-success" : "text-content-faint"
              }`}
            >
              {waterRoundAvailable
                ? "Wasserrunde — alle bekommen einen Joker"
                : `Wasserrunde in Akt ${act} schon gelaufen`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default SessionBar;
