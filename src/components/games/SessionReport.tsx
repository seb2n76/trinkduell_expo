import React from "react";
import { Modal, View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { useThemeColors } from "@/services/theme";
import { useNightSession, SessionPlayer, DossierEntry } from "@/games/session";

interface SessionReportProps {
  visible: boolean;
  onClose: () => void;
  onEndSession?: () => void;
}

export function SessionReport({ visible, onClose, onEndSession }: SessionReportProps) {
  const c = useThemeColors();
  const session = useNightSession();

  if (!session || !visible) return null;

  const { players, rounds, act, actLabel, dossier, activeRules } = session;

  const rankedPlayers: SessionPlayer[] = [...players].sort((a, b) => b.points - a.points);
  const winner = rankedPlayers.length > 0 ? rankedPlayers[0] : null;

  // Top Dossier-Einträge (bis zu 4 Einträge)
  const topDossier: DossierEntry[] = (dossier || []).slice(0, 4);

  // Gesamtzahl verbliebener Joker
  const totalUnusedJokers = players.reduce((sum, p) => sum + (p.jokers || 0), 0);

  const handleFinish = () => {
    triggerHaptic("success");
    if (onEndSession) {
      onEndSession();
    } else {
      session.end();
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View className="flex-1 bg-black/90 justify-center items-center px-4 py-8">
        <View className="bg-surface border-2 border-accent/40 w-full max-w-[420px] max-h-[90%] rounded-3xl p-5 shadow-2xl flex-col">
          {/* Header */}
          <View className="items-center mb-4 pb-3 border-b border-line">
            <View className="w-12 h-12 rounded-full bg-accent/20 border border-accent/40 items-center justify-center mb-2">
              <Ionicons name="trophy" size={26} color={c.accent} />
            </View>
            <Text className="text-content text-lg font-black uppercase tracking-wider text-center">
              Auswertung der Nacht
            </Text>
            <Text className="text-accent text-xs font-black uppercase tracking-widest mt-0.5">
              {actLabel} · {rounds} Runden gespielt
            </Text>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Winner Spotlight */}
            {winner && (
              <View className="bg-accent/10 border-2 border-accent/40 rounded-2xl p-4 mb-4 items-center">
                <Text className="text-accent text-[10px] font-black uppercase tracking-widest mb-1">
                  👑 Sieger der Nacht
                </Text>
                <Text className="text-content text-xl font-black text-center mb-1" numberOfLines={1}>
                  {winner.name}
                </Text>
                {session.titleFor(winner.id) && (
                  <View className="bg-accent/20 px-2.5 py-0.5 rounded-full mb-2">
                    <Text className="text-accent text-[11px] font-black">
                      {session.titleFor(winner.id)}
                    </Text>
                  </View>
                )}
                <View className="flex-row items-center gap-4 mt-1">
                  <View className="items-center">
                    <Text className="text-content-faint text-[9px] font-black uppercase">Punkte</Text>
                    <Text className="text-accent text-lg font-black">{winner.points}</Text>
                  </View>
                  <View className="w-[1px] h-6 bg-line" />
                  <View className="items-center">
                    <Text className="text-content-faint text-[9px] font-black uppercase">Joker übrig</Text>
                    <Text className="text-content text-lg font-black">{"🃏".repeat(winner.jokers) || "0"}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Rangliste */}
            <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-2">
              Rangliste &amp; Titel
            </Text>
            <View className="gap-2 mb-4">
              {rankedPlayers.map((p, idx) => {
                const title = session.titleFor(p.id);
                const isWinner = idx === 0;
                return (
                  <View
                    key={p.id}
                    className={`flex-row items-center justify-between p-3 rounded-2xl border ${
                      isWinner
                        ? "bg-accent/15 border-accent/40"
                        : "bg-surface-alt/40 border-line"
                    }`}
                  >
                    <View className="flex-row items-center flex-1 mr-2">
                      <View className="w-6 items-center mr-2">
                        {isWinner ? (
                          <Text className="text-base">👑</Text>
                        ) : (
                          <Text className="text-content-faint text-xs font-black">
                            #{idx + 1}
                          </Text>
                        )}
                      </View>
                      <View className="flex-1">
                        <Text className="text-content text-sm font-bold" numberOfLines={1}>
                          {p.name}
                        </Text>
                        {title && (
                          <Text className="text-accent text-[10px] font-black">
                            {title}
                          </Text>
                        )}
                      </View>
                    </View>

                    <View className="flex-row items-center gap-3">
                      <Text className="text-content-faint text-xs font-bold">
                        {"🃏".repeat(p.jokers) || "—"}
                      </Text>
                      <View className="bg-surface px-2.5 py-1 rounded-xl border border-line min-w-[40px] items-center">
                        <Text className="text-content font-black text-sm">
                          {p.points}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Top Dossier Highlights */}
            {topDossier.length > 0 && (
              <View className="mb-4">
                <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-2">
                  Dossier: Was die Nacht enthüllt hat
                </Text>
                <View className="bg-surface-alt/30 border border-line rounded-2xl p-3 gap-2">
                  {topDossier.map((entry) => {
                    const player = players.find((p) => p.id === entry.playerId);
                    return (
                      <View key={entry.id} className="flex-row items-start">
                        <Text className="text-accent mr-2 text-xs">🔍</Text>
                        <View className="flex-1">
                          <Text className="text-content text-xs font-bold">
                            {player ? player.name : "Jemand"}:{" "}
                            <Text className="text-content-faint font-normal">{entry.text}</Text>
                          </Text>
                          <Text className="text-content-faint text-[9px] font-medium mt-0.5">
                            Gemerkt in Akt {entry.act}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Session Stats */}
            <View className="bg-surface-alt/40 border border-line rounded-2xl p-3 mb-4 flex-row justify-around">
              <View className="items-center">
                <Text className="text-content-faint text-[9px] font-black uppercase">Erreichter Akt</Text>
                <Text className="text-content text-sm font-black mt-0.5">{act} / 3</Text>
              </View>
              <View className="w-[1px] h-8 bg-line" />
              <View className="items-center">
                <Text className="text-content-faint text-[9px] font-black uppercase">Gültige Regeln</Text>
                <Text className="text-content text-sm font-black mt-0.5">{activeRules.length}</Text>
              </View>
              <View className="w-[1px] h-8 bg-line" />
              <View className="items-center">
                <Text className="text-content-faint text-[9px] font-black uppercase">Joker im Team</Text>
                <Text className="text-content text-sm font-black mt-0.5">{totalUnusedJokers}</Text>
              </View>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View className="gap-2 pt-3 border-t border-line mt-2">
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleFinish}
              className="w-full bg-accent py-3.5 rounded-2xl items-center justify-center shadow-lg active:scale-95"
            >
              <Text className="text-on-accent font-black text-xs uppercase tracking-wider">
                Session beenden &amp; zurücksetzen
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                triggerHaptic("light");
                onClose();
              }}
              className="w-full bg-surface border border-line py-2.5 rounded-xl items-center justify-center"
            >
              <Text className="text-content-muted font-bold text-xs">
                Schließen (Weiter spielen)
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default SessionReport;
