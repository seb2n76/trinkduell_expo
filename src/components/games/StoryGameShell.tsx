import React, { useState, useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { useThemeColors } from "@/services/theme";
import { apiService } from "@/services/api";
import { getStoryGame } from "@/games/stories";
import { StoryGameId } from "@/games/storyEngine/types";
import { ProofPhotoButton } from "./ProofPhotoButton";

interface StoryGameShellProps {
  visible: boolean;
  roomCode: string;
  myPlayerId: string;
  /** Nachweis gegenueber dem Raum. Nicht die playerId — die kennt jeder. */
  myPlayerToken: string;
  initialRoomData: any;
  onExit: () => void;
}

export function StoryGameShell({
  visible,
  roomCode,
  myPlayerId,
  myPlayerToken,
  initialRoomData,
  onExit,
}: StoryGameShellProps) {
  const c = useThemeColors();
  const [room, setRoom] = useState<any>(initialRoomData);
  const [showSecretRole, setShowSecretRole] = useState(false);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState<string | null>(null);
  const [actionDone, setActionDone] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const gameId = (room?.gameId || "court_treason") as StoryGameId;
  const gameDef = getStoryGame(gameId);

  const me = room?.players?.find((p: any) => p.id === myPlayerId);
  const isHost = me?.isHost || room?.hostId === myPlayerId;
  const currentChapter = room?.gameState?.currentChapter;

  // Poll room updates
  const fetchRoomState = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await apiService.getGameRoom(roomCode, myPlayerToken);
      if (res && res.success && res.room) {
        setRoom(res.room);
      }
    } catch (err) {
      console.warn("Failed to fetch room state:", err);
    }
  }, [roomCode, myPlayerToken]);

  useEffect(() => {
    if (!visible || !roomCode) return;
    const interval = setInterval(fetchRoomState, 2500);
    return () => clearInterval(interval);
  }, [visible, roomCode, fetchRoomState]);

  // Handle player action submission
  const handleAction = async (choice: any, targetId?: string) => {
    triggerHaptic("medium");
    setActionDone(true);
    setActionFeedback(choice.outcomeText);

    try {
      await apiService.submitGameRoomAction(roomCode, myPlayerToken, "player_choice", {
        choiceId: choice.id,
        targetPlayerId: targetId,
        sips: choice.sips || 0,
        damage: choice.damage || 0,
      });

      if (choice.sips && choice.sips > 0) {
        await apiService.submitGameRoomAction(roomCode, myPlayerToken, "drink", {
          count: choice.sips,
        });
      }
    } catch (err) {
      console.warn("Error submitting action:", err);
    }
  };

  // Handle vote submission
  const handleVote = async (targetPlayerId: string) => {
    triggerHaptic("heavy");
    setSelectedVoteTarget(targetPlayerId);

    try {
      await apiService.submitGameRoomAction(roomCode, myPlayerToken, "vote", {
        targetPlayerId,
      });
    } catch (err) {
      console.warn("Error submitting vote:", err);
    }
  };

  // Host advances chapter
  const handleNextChapter = async () => {
    if (!isHost || !room) return;
    setAdvancing(true);
    triggerHaptic("medium");

    try {
      const nextIndex = (room.currentChapterIndex || 0) + 1;

      if (nextIndex >= gameDef.chapters.length) {
        // Finale reached! Evaluate votes and end
        const finaleResult = gameDef.evaluateFinale(
          room.players,
          room.gameState?.votes || {},
          room.gameState?.customVariables || {}
        );

        await apiService.nextGameRoomChapter(roomCode, myPlayerToken, {
          nextStatus: "finale",
          outcomeSummary: finaleResult.summary,
        });
      } else {
        // Next chapter
        const nextChap = gameDef.chapters[nextIndex];
        const nextChapterData = {
          id: nextChap.id,
          act: nextChap.act,
          title: nextChap.title,
          atmosphereHint: nextChap.atmosphereHint,
          text: nextChap.generateText(room.players, room.gameState?.customVariables || {}),
          interactivePrompt: nextChap.interactivePrompt,
          hasVoting: nextChap.hasVoting,
          votingPrompt: nextChap.votingPrompt,
        };

        await apiService.nextGameRoomChapter(roomCode, myPlayerToken, {
          nextStatus: "story_chapter",
          nextChapterData,
          outcomeSummary: `Kapitel ${nextChap.act} erreicht`,
        });
        setActionDone(false);
        setActionFeedback(null);
        setSelectedVoteTarget(null);
      }
      await fetchRoomState();
    } catch (err: any) {
      console.error("Error advancing chapter:", err);
    } finally {
      setAdvancing(false);
    }
  };

  const handleExit = async () => {
    triggerHaptic("light");
    try {
      await apiService.leaveGameRoom(roomCode, myPlayerToken);
    } catch (err) {
      console.warn("Error leaving room:", err);
    }
    onExit();
  };

  const isFinale = room?.status === "finale";
  const finaleData = isFinale
    ? gameDef.evaluateFinale(
        room.players,
        room.gameState?.finalVotes || room.gameState?.votes || {},
        room.gameState?.customVariables || {}
      )
    : null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View className="flex-1 bg-bg pt-14 px-5">
        {/* Top Bar */}
        <View className="flex-row items-center justify-between mb-3">
          <TouchableOpacity onPress={handleExit} className="flex-row items-center p-1">
            <Ionicons name="close-circle-outline" size={20} color={c.warning} />
            <Text className="text-warning text-xs font-black uppercase ml-1">Beenden</Text>
          </TouchableOpacity>

          <View className="items-center">
            <Text className="text-content text-xs font-black uppercase tracking-wider">
              {gameDef.title}
            </Text>
            <Text className="text-content-faint text-[9px] font-bold">
              Raum: {roomCode}
            </Text>
          </View>

          <View className="items-center mb-1">
            <ProofPhotoButton context={gameDef.title} />
          </View>
        </View>

        {/* Co-Op Health Bar (e.g. Haunted Manor) */}
        {room?.gameState?.healthPoints !== undefined && (
          <View className="bg-surface border border-line rounded-2xl p-2.5 mb-3 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Ionicons name="heart" size={16} color={c.danger} />
              <Text className="text-content text-xs font-black ml-1.5">Team-HP</Text>
            </View>
            <View className="flex-1 mx-3 h-2 bg-bg rounded-full overflow-hidden">
              <View
                style={{ width: `${Math.max(0, Math.min(100, room.gameState.healthPoints))}%` }}
                className={`h-full rounded-full ${
                  room.gameState.healthPoints > 40 ? "bg-success" : "bg-danger"
                }`}
              />
            </View>
            <Text className="text-content text-xs font-black">{room.gameState.healthPoints}%</Text>
          </View>
        )}

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {/* Secret Role Card */}
          {me?.role && (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                triggerHaptic("light");
                setShowSecretRole(!showSecretRole);
              }}
              className="bg-surface border border-accent/40 rounded-2xl p-3.5 mb-4 shadow-md"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Ionicons
                    name={showSecretRole ? "eye-outline" : "eye-off-outline"}
                    size={18}
                    color={c.accent}
                  />
                  <Text className="text-accent text-xs font-black uppercase tracking-wider ml-2">
                    {showSecretRole ? "Geheime Rolle: " + me.role : "Geheime Rolle ansehen (Tippen)"}
                  </Text>
                </View>
                <Ionicons
                  name={showSecretRole ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={c.contentFaint}
                />
              </View>

              {showSecretRole && me.secretPrompt && (
                <View className="mt-2.5 pt-2.5 border-t border-line">
                  <Text className="text-content text-xs font-medium leading-relaxed">
                    {me.secretPrompt}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* FINALE SCREEN */}
          {isFinale && finaleData ? (
            <View className="bg-surface border-2 border-accent rounded-3xl p-6 shadow-2xl mb-6 items-center">
              <View className="w-14 h-14 rounded-full bg-accent/20 border border-accent items-center justify-center mb-3">
                <Ionicons name="trophy" size={28} color={c.accent} />
              </View>
              <Text className="text-accent text-[10px] font-black uppercase tracking-widest mb-1">
                Gewinner-Team
              </Text>
              <Text className="text-content text-xl font-black text-center mb-2">
                {finaleData.winnerTeam}
              </Text>
              <Text className="text-content-faint text-xs font-medium text-center leading-relaxed mb-5">
                {finaleData.summary}
              </Text>

              {/* Drinking Penalties */}
              <View className="w-full bg-bg border border-line rounded-2xl p-4">
                <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider mb-2.5">
                  Trink-Urteile 🍻
                </Text>
                {finaleData.drinkPenalties.map((penalty, idx) => (
                  <View
                    key={idx}
                    className="flex-row items-center justify-between py-1.5 border-b border-line last:border-0"
                  >
                    <View className="flex-1 mr-2">
                      <Text className="text-content text-xs font-bold">{penalty.playerName}</Text>
                      <Text className="text-content-faint text-[9px]">{penalty.reason}</Text>
                    </View>
                    <View className="bg-danger/20 px-2 py-0.5 rounded-md">
                      <Text className="text-danger text-xs font-black">{penalty.sips}x Schluck</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            /* STORY CHAPTER VIEW */
            <View>
              {/* Chapter Header */}
              {currentChapter && (
                <View className="bg-surface border border-line rounded-3xl p-6 shadow-xl mb-4">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-accent text-[10px] font-black uppercase tracking-wider">
                      {currentChapter.title}
                    </Text>
                    <View className="bg-bg px-2 py-0.5 rounded-full border border-line">
                      <Text className="text-content-faint text-[9px] font-bold">
                        Akt {currentChapter.act}
                      </Text>
                    </View>
                  </View>

                  <Text className="text-content text-base font-bold leading-relaxed mb-3">
                    {currentChapter.text}
                  </Text>

                  {currentChapter.atmosphereHint && (
                    <Text className="text-content-faint text-[11px] italic font-medium">
                      &quot;{currentChapter.atmosphereHint}&quot;
                    </Text>
                  )}
                </View>
              )}

              {/* Feedback after action */}
              {actionFeedback && (
                <View className="bg-success/10 border border-success/30 p-3.5 rounded-2xl mb-4 flex-row items-center">
                  <Ionicons name="checkmark-circle" size={18} color={c.success} />
                  <Text className="text-success text-xs font-bold ml-2 flex-1">
                    {actionFeedback}
                  </Text>
                </View>
              )}

              {/* Interactive Choices (if available in this chapter) */}
              {currentChapter?.interactivePrompt && !actionDone && (
                <View className="bg-surface border border-line rounded-3xl p-5 mb-4 shadow-lg">
                  <Text className="text-content text-xs font-black uppercase tracking-wide mb-1">
                    {currentChapter.interactivePrompt.title}
                  </Text>
                  <Text className="text-content-faint text-[11px] font-medium mb-3">
                    {currentChapter.interactivePrompt.description}
                  </Text>

                  <View className="gap-2">
                    {currentChapter.interactivePrompt.choices.map((choice: any) => (
                      <TouchableOpacity
                        key={choice.id}
                        activeOpacity={0.85}
                        onPress={() => handleAction(choice)}
                        className="bg-bg border border-line p-3 rounded-xl flex-row items-center justify-between active:border-accent"
                      >
                        <Text className="text-content text-xs font-bold flex-1 mr-2">
                          {choice.label}
                        </Text>
                        <Ionicons name="arrow-forward" size={14} color={c.accent} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Voting Phase (if active in this chapter) */}
              {currentChapter?.hasVoting && (
                <View className="bg-surface border-2 border-warning/40 rounded-3xl p-5 mb-4 shadow-xl">
                  <View className="flex-row items-center mb-1">
                    <Ionicons name="finger-print" size={16} color={c.warning} />
                    <Text className="text-warning text-xs font-black uppercase tracking-wider ml-1.5">
                      Abstimmung
                    </Text>
                  </View>
                  <Text className="text-content text-sm font-black mb-3">
                    {currentChapter.votingPrompt || "Wen wählst du?"}
                  </Text>

                  <View className="gap-2">
                    {room?.players
                      ?.filter((p: any) => p.id !== myPlayerId)
                      ?.map((candidate: any) => {
                        const isSelected = selectedVoteTarget === candidate.id;
                        return (
                          <TouchableOpacity
                            key={candidate.id}
                            activeOpacity={0.85}
                            onPress={() => handleVote(candidate.id)}
                            className={`flex-row items-center justify-between p-3 rounded-xl border ${
                              isSelected
                                ? "bg-warning/20 border-warning"
                                : "bg-bg border-line"
                            }`}
                          >
                            <View className="flex-row items-center">
                              <View className="w-7 h-7 rounded-full bg-surface border border-line items-center justify-center mr-2.5 overflow-hidden">
                                {candidate.avatar ? (
                                  <Image source={{ uri: candidate.avatar }} className="w-full h-full" />
                                ) : (
                                  <Ionicons name="person" size={14} color={c.contentFaint} />
                                )}
                              </View>
                              <Text className="text-content text-xs font-bold">
                                {candidate.name}
                              </Text>
                            </View>
                            {isSelected ? (
                              <Ionicons name="checkmark-circle" size={18} color={c.warning} />
                            ) : (
                              <Ionicons name="radio-button-off" size={18} color={c.contentFaint} />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Host Control Action Bar */}
        <View className="py-4 border-t border-line">
          {isHost ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={isFinale ? handleExit : handleNextChapter}
              disabled={advancing}
              className="w-full bg-accent py-4 rounded-2xl items-center justify-center flex-row shadow-lg disabled:opacity-40"
            >
              {advancing ? (
                <ActivityIndicator size="small" color={c.onAccent} />
              ) : (
                <>
                  <Ionicons
                    name={isFinale ? "checkmark-done" : "arrow-forward"}
                    size={18}
                    color={c.onAccent}
                  />
                  <Text className="text-on-accent font-black text-xs uppercase tracking-wider ml-2">
                    {isFinale ? "Spiel beenden" : "Nächstes Kapitel ➔"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View className="items-center py-2">
              <Text className="text-content-faint text-[11px] font-bold">
                {isFinale
                  ? "Das Spiel ist beendet!"
                  : "Warte auf die Entscheidung des Hosts..."}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
