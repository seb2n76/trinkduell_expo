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
      <View className="flex-1 bg-bg pt-14 px-5">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
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
          <View className="bg-surface border-2 border-accent/40 rounded-3xl p-6 items-center shadow-2xl mb-6">
            <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest mb-1">
              Raum-Code für Mitspieler
            </Text>
            <View className="flex-row items-center justify-center my-2">
              {roomCode.split("").map((char, index) => (
                <View
                  key={index}
                  className="bg-bg border border-accent/30 w-12 h-14 rounded-2xl items-center justify-center mx-1 shadow-md"
                >
                  <Text className="text-accent text-3xl font-black">{char}</Text>
                </View>
              ))}
            </View>
            <Text className="text-content-faint text-[11px] font-bold text-center mt-2">
              Freunde öffnen TrinkDuell → <Text className="text-content font-black">„Lobby beitreten“</Text> → Code eingeben
            </Text>
          </View>

          {/* Game Selector (Host only) or Game Preview (Client) */}
          {isHost ? (
            <View className="mb-6">
              <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider mb-2.5">
                Story-Spiel auswählen
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
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
                      style={{
                        borderColor: isSelected ? game.accentColor : "transparent",
                      }}
                      className={`w-64 bg-surface border-2 rounded-2xl p-4 mr-3 shadow-lg ${
                        isSelected ? "border-accent" : "border-line"
                      }`}
                    >
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="px-2 py-0.5 rounded-full bg-accent/20">
                          <Text className="text-accent text-[8px] font-black uppercase">
                            {game.genre}
                          </Text>
                        </View>
                        <Text className="text-content-faint text-[9px] font-bold">
                          {game.minPlayers}–{game.maxPlayers} Spieler
                        </Text>
                      </View>
                      <Text className="text-content text-sm font-black mb-1">{game.title}</Text>
                      <Text className="text-content-faint text-[10px] font-medium leading-relaxed" numberOfLines={2}>
                        {game.description}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <View className="bg-surface border border-line rounded-2xl p-4 mb-6">
              <View className="flex-row items-center mb-1">
                <Ionicons name="sparkles" size={14} color={c.accent} />
                <Text className="text-content text-xs font-black uppercase ml-1.5">
                  {selectedGame.title}
                </Text>
              </View>
              <Text className="text-content-faint text-[11px] font-medium">
                {selectedGame.description}
              </Text>
            </View>
          )}

          {/* Players in Lobby */}
          <View className="mb-8">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider">
                Bereite Spieler ({room?.players?.length || 1})
              </Text>
              <View className="flex-row items-center">
                <View className="w-2 h-2 rounded-full bg-success mr-1.5 animate-pulse" />
                <Text className="text-success text-[10px] font-bold">Live</Text>
              </View>
            </View>

            {loading && !room ? (
              <ActivityIndicator size="small" color={c.accent} />
            ) : (
              <View className="gap-2">
                {room?.players?.map((player: any, idx: number) => {
                  const isMe = player.id === myPlayerId;
                  return (
                    <View
                      key={player.id || idx}
                      className={`flex-row items-center justify-between p-3.5 rounded-2xl border ${
                        isMe
                          ? "bg-accent/10 border-accent/40"
                          : "bg-surface border-line"
                      }`}
                    >
                      <View className="flex-row items-center">
                        <View className="w-9 h-9 rounded-full bg-bg border border-line items-center justify-center mr-3 overflow-hidden">
                          {player.avatar ? (
                            <Image source={{ uri: player.avatar }} className="w-full h-full" />
                          ) : (
                            <Ionicons name="person" size={16} color={c.contentFaint} />
                          )}
                        </View>
                        <View>
                          <View className="flex-row items-center">
                            <Text className="text-content text-xs font-black mr-2">
                              {player.name}
                            </Text>
                            {player.isHost && (
                              <View className="bg-warning/20 border border-warning/40 px-1.5 py-0.2 rounded">
                                <Text className="text-warning text-[8px] font-black uppercase">
                                  Host 👑
                                </Text>
                              </View>
                            )}
                            {isMe && (
                              <Text className="text-accent text-[9px] font-bold ml-1">
                                (Du)
                              </Text>
                            )}
                          </View>
                          <Text className="text-content-faint text-[9px] font-bold mt-0.5">
                            Bereit zum Mitspielen
                          </Text>
                        </View>
                      </View>

                      <Ionicons name="checkmark-circle" size={18} color={c.success} />
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
              className="w-full bg-accent py-4 rounded-2xl items-center justify-center flex-row shadow-lg disabled:opacity-40"
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
              <ActivityIndicator size="small" color={c.accent} className="mr-2.5" />
              <Text className="text-content-faint text-xs font-bold">
                Warte auf Spielstart durch den Host...
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
