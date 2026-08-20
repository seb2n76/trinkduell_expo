import React, { useState, useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/services/haptics";
import { useThemeColors } from "@/services/theme";
import { apiService } from "@/services/api";
import { STORY_GAMES_LIST, getStoryGame } from "@/games/stories";
import { StoryGameId } from "@/games/storyEngine/types";

interface MultiplayerLobbyModalProps {
  visible: boolean;
  roomCode: string;
  myPlayerId: string;
  /** Nachweis gegenueber dem Raum. Nicht die playerId — die kennt jeder. */
  myPlayerToken: string;
  isHost: boolean;
  onClose: () => void;
  onGameStarted: (roomData: any) => void;
}

export function MultiplayerLobbyModal({
  visible,
  roomCode,
  myPlayerId,
  myPlayerToken,
  isHost,
  onClose,
  onGameStarted,
}: MultiplayerLobbyModalProps) {
  const c = useThemeColors();
  const [room, setRoom] = useState<any>(null);
  const [selectedGameId, setSelectedGameId] = useState<StoryGameId>("court_treason");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const selectedGame = getStoryGame(selectedGameId);

  // Poll room data periodically
  const fetchRoomState = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await apiService.getGameRoom(roomCode, myPlayerToken);
      if (res && res.success && res.room) {
        setRoom(res.room);
        if (res.room.status !== "lobby") {
          // Game has started!
          onGameStarted(res.room);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch game room state:", err);
    } finally {
      setLoading(false);
    }
  }, [roomCode, myPlayerToken, onGameStarted]);

  useEffect(() => {
    if (!visible || !roomCode) return;
    fetchRoomState();
    const interval = setInterval(fetchRoomState, 2500);
    return () => clearInterval(interval);
  }, [visible, roomCode, fetchRoomState]);

  const handleStartGame = async () => {
    if (!isHost || !room) return;

    if (room.players.length < selectedGame.minPlayers) {
      const msg = `Für dieses Spiel werden mindestens ${selectedGame.minPlayers} Spieler benötigt (aktuell: ${room.players.length}).`;
      if (Platform.OS === "web") {
        window.alert(msg);
      } else {
        Alert.alert("Zu wenige Spieler", msg);
      }
      return;
    }

    setStarting(true);
    triggerHaptic("heavy");

    try {
      // 1. Procedural role assignment
      const assignedRoles = selectedGame.assignRoles(room.players);
      const firstChapter = selectedGame.chapters[0];

      const gameSetupData = {
        playerRoles: assignedRoles,
        firstChapter: {
          id: firstChapter.id,
          act: firstChapter.act,
          title: firstChapter.title,
          atmosphereHint: firstChapter.atmosphereHint,
          text: firstChapter.generateText(room.players, {}),
          interactivePrompt: firstChapter.interactivePrompt,
          hasVoting: firstChapter.hasVoting,
          votingPrompt: firstChapter.votingPrompt,
        },
        customVariables: {
          gameId: selectedGameId,
          healthPoints: 100,
        },
      };

      const res = await apiService.startGameRoom(roomCode, myPlayerToken, gameSetupData);
      if (res && res.success && res.room) {
        triggerHaptic("success");
        onGameStarted(res.room);
      }
    } catch (err: any) {
      triggerHaptic("error");
      const msg = err.response?.data?.error || err.message || "Spiel konnte nicht gestartet werden.";
      if (Platform.OS === "web") {
        window.alert(msg);
      } else {
        Alert.alert("Fehler", msg);
      }
    } finally {
      setStarting(false);
    }
  };

  const handleLeave = async () => {
    triggerHaptic("light");
    try {
      await apiService.leaveGameRoom(roomCode, myPlayerToken);
    } catch (err) {
      console.warn("Error leaving room:", err);
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View className="flex-1 bg-bg pt-14 px-5 items-center">
        <View className="w-full max-w-2xl flex-1">
          {/* Header */}
          <View className="flex-row items-center justify-between mb-5">
            <TouchableOpacity onPress={handleLeave} className="flex-row items-center p-1">
              <Ionicons name="close-circle-outline" size={20} color={c.warning} />
              <Text className="text-warning text-xs font-black uppercase ml-1">Verlassen</Text>
            </TouchableOpacity>

            <Text className="text-content text-sm font-black uppercase tracking-wider">
              Multiplayer-Lobby
            </Text>

            <View className="w-16" />
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Room Code Showcase */}
            <View className="bg-surface border border-line rounded-3xl p-6 items-center shadow-sm mb-6">
              <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-2">
                Raum-Code für Mitspieler
              </Text>
              <View className="flex-row items-center justify-center my-2">
                {roomCode.split("").map((char, index) => (
                  <View
                    key={index}
                    className="bg-surface-alt border border-line w-12 h-14 rounded-2xl items-center justify-center mx-1.5 shadow-sm"
                  >
                    <Text className="text-warning text-3xl font-black font-mono">{char}</Text>
                  </View>
                ))}
              </View>
              <Text className="text-content-faint text-[11px] font-bold text-center mt-3">
                Freunde öffnen TrinkDuell → <Text className="text-content font-black">„Lobby beitreten“</Text> → Code eingeben
              </Text>
            </View>

            {/* Game Selector (Host only) or Game Preview (Client) */}
            {isHost ? (
              <View className="mb-6">
                <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider mb-3">
                  Story-Spiel auswählen
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 12, paddingTop: 4, paddingHorizontal: 2 }}
                >
                  {STORY_GAMES_LIST.map((game) => {
                    const isSelected = game.id === selectedGameId;
                    return (
                      <TouchableOpacity
                        key={game.id}
                        activeOpacity={0.85}
                        onPress={() => {
                          triggerHaptic("light");
                          setSelectedGameId(game.id);
                        }}
                        className={`w-72 bg-surface rounded-3xl p-5 mr-3 shadow-md ${
                          isSelected
                            ? "border-2 border-warning bg-warning/5"
                            : "border border-line"
                        }`}
                      >
                        <View className="flex-row items-center justify-between mb-2.5">
                          <View className="px-2.5 py-0.5 rounded-full bg-surface-alt border border-line">
                            <Text className="text-warning text-[8px] font-black uppercase">
                              {game.genre}
                            </Text>
                          </View>
                          <Text className="text-content-faint text-[9px] font-bold">
                            {game.minPlayers}–{game.maxPlayers} Spieler
                          </Text>
                        </View>
                        <Text className="text-content text-sm font-black mb-1.5">{game.title}</Text>
                        <Text className="text-content-muted text-[11px] font-medium leading-relaxed" numberOfLines={2}>
                          {game.description}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <View className="bg-surface border border-line rounded-3xl p-5 mb-6 shadow-sm">
                <View className="flex-row items-center mb-1.5">
                  <Ionicons name="sparkles" size={16} color={c.warning} />
                  <Text className="text-content text-xs font-black uppercase ml-2">
                    {selectedGame.title}
                  </Text>
                </View>
                <Text className="text-content-muted text-xs font-medium leading-relaxed">
                  {selectedGame.description}
                </Text>
              </View>
            )}

            {/* Players in Lobby */}
            <View className="mb-8">
              <View className="flex-row items-center justify-between mb-3 px-1">
                <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider">
                  Bereite Spieler ({room?.players?.length || 1})
                </Text>
                <View className="flex-row items-center">
                  <View className="w-2 h-2 rounded-full bg-success mr-1.5" />
                  <Text className="text-success text-[10px] font-bold">Live</Text>
                </View>
              </View>

              {loading && !room ? (
                <ActivityIndicator size="small" color={c.warning} />
              ) : (
                <View className="gap-2.5">
                  {room?.players?.map((player: any, idx: number) => {
                    const isMe = player.id === myPlayerId;
                    return (
                      <View
                        key={player.id || idx}
                        className={`flex-row items-center justify-between p-4 rounded-2xl border shadow-sm ${
                          isMe
                            ? "bg-warning/10 border-warning/50"
                            : "bg-surface border-line"
                        }`}
                      >
                        <View className="flex-row items-center">
                          <View className="w-10 h-10 rounded-full bg-surface-alt border border-line items-center justify-center mr-3 overflow-hidden">
                            {player.avatar ? (
                              <Image source={{ uri: player.avatar }} className="w-full h-full" />
                            ) : (
                              <Ionicons name="person" size={18} color={c.contentFaint} />
                            )}
                          </View>
                          <View>
                            <View className="flex-row items-center">
                              <Text className="text-content text-xs font-black mr-2">
                                {player.name}
                              </Text>
                              {player.isHost && (
                                <View className="bg-warning/20 border border-warning/40 px-1.5 py-0.5 rounded">
                                  <Text className="text-warning text-[8px] font-black uppercase">
                                    Host 👑
                                  </Text>
                                </View>
                              )}
                              {isMe && (
                                <Text className="text-warning text-[9px] font-bold ml-1.5">
                                  (Du)
                                </Text>
                              )}
                            </View>
                            <Text className="text-content-faint text-[9px] font-bold mt-0.5">
                              Bereit zum Mitspielen
                            </Text>
                          </View>
                        </View>

                        <Ionicons name="checkmark-circle" size={20} color={c.success} />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>

          {/* Start Game Action Bar (Host) or Waiting status (Client) */}
          <View className="py-4 border-t border-line">
            {isHost ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleStartGame}
                disabled={starting || (room?.players?.length || 0) < selectedGame.minPlayers}
                className="w-full bg-warning py-4 rounded-2xl items-center justify-center flex-row shadow-lg active:scale-95 disabled:opacity-40"
              >
                {starting ? (
                  <ActivityIndicator size="small" color={c.onAccent} />
                ) : (
                  <>
                    <Ionicons name="play" size={18} color={c.onAccent} />
                    <Text className="text-on-accent font-black text-xs uppercase tracking-wider ml-2">
                      Story-Spiel starten
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <View className="flex-row items-center justify-center py-2">
                <ActivityIndicator size="small" color={c.warning} className="mr-2.5" />
                <Text className="text-content-faint text-xs font-bold">
                  Warte auf Spielstart durch den Host...
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
