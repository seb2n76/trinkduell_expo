import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { ChapterChoice, StoryGameId, StoryRoom } from "@/games/storyEngine/types";
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

/**
 * Anzeige einer laufenden Story-Runde.
 *
 * Der Server ist die Spielinstanz: er verteilt Rollen, rendert Kapitel,
 * rechnet Punkte und Team-Variablen und wertet das Finale aus. Diese
 * Komponente zeigt an und schickt Absichten zurück — mehr nicht.
 *
 * Bis August 2026 lag die Logik hier: der Client des Hosts baute die Kapitel
 * und berechnete das Finale. Die Punkte einer Auswahl kamen deshalb nie an,
 * die HP-Leiste bewegte sich nie, und wer Host war, bestimmte den Ausgang.
 */
export function StoryGameShell({
  visible,
  roomCode,
  myPlayerId,
  myPlayerToken,
  initialRoomData,
  onExit,
}: StoryGameShellProps) {
  const c = useThemeColors();
  const [room, setRoom] = useState<StoryRoom | null>(initialRoomData);
  const [showSecretRole, setShowSecretRole] = useState(false);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<ChapterChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedPoints, setClaimedPoints] = useState<number | null>(null);
  // Abrechnen genau einmal pro Runde, auch wenn der Poll das Finale mehrfach
  // liefert. Der Server ist zwar idempotent, aber ein Request alle 2,5 s wäre
  // trotzdem Unsinn.
  const claimAttempted = useRef(false);

  const gameId = (room?.gameId || "court_treason") as StoryGameId;
  const meta = getStoryGame(gameId);

  const me = room?.players?.find((p) => p.id === myPlayerId);
  const isHost = room?.isHost || room?.hostId === myPlayerId;
  const chapter = room?.gameState?.currentChapter || null;
  const isFinale = room?.status === "finale";
  const finale = room?.gameState?.finale || null;
  const myChoice = room?.gameState?.myChoice || null;
  const healthPoints = room?.gameState?.healthPoints;

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

  // Punkte gutschreiben, sobald das Finale steht.
  useEffect(() => {
    if (!isFinale || claimAttempted.current) return;
    claimAttempted.current = true;
    apiService
      .claimGameRoomPoints(roomCode, myPlayerToken)
      .then((res) => {
        if (res.awarded) setClaimedPoints(res.points);
      })
      .catch(() => {
        // Gäste ohne Konto bekommen hier eine Absage — das ist kein Fehler,
        // sie haben nur nichts, wo die Punkte hinkönnten.
      });
  }, [isFinale, roomCode, myPlayerToken]);

  /** Auswahl abschicken. Braucht die Auswahl ein Ziel, kommt erst der Picker. */
  const chooseOption = async (choice: ChapterChoice, targetId?: string) => {
    if (choice.targetRequired && !targetId) {
      triggerHaptic("light");
      setPendingChoice(choice);
      return;
    }

    triggerHaptic("medium");
    setBusy(true);
    setError(null);
    try {
      const res = await apiService.submitGameRoomAction(roomCode, myPlayerToken, "choice", {
        choiceId: choice.id,
        targetPlayerId: targetId,
      });
      if (res?.room) setRoom(res.room);
      setPendingChoice(null);
    } catch (err: any) {
      setError(err?.message || "Die Auswahl kam nicht durch.");
    } finally {
      setBusy(false);
    }
  };

  const handleVote = async (targetPlayerId: string) => {
    triggerHaptic("heavy");
    setSelectedVoteTarget(targetPlayerId);
    try {
      const res = await apiService.submitGameRoomAction(roomCode, myPlayerToken, "vote", {
        targetPlayerId,
      });
      if (res?.room) setRoom(res.room);
    } catch (err) {
      console.warn("Error submitting vote:", err);
    }
  };

  /**
   * Der Host löst den Wechsel aus — welches Kapitel folgt und wie das Finale
   * ausgeht, entscheidet der Server.
   */
  const handleNext = async () => {
    if (!isHost) return;
    setBusy(true);
    triggerHaptic("medium");
    try {
      const res = await apiService.nextGameRoomChapter(roomCode, myPlayerToken, {});
      if (res?.room) setRoom(res.room);
      setSelectedVoteTarget(null);
      setPendingChoice(null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Der Wechsel hat nicht geklappt.");
    } finally {
      setBusy(false);
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

  const others = (room?.players || []).filter((p) => p.id !== myPlayerId);
  const chosenCount = room?.gameState?.choiceCount || 0;
  const totalPlayers = room?.players?.length || 0;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View className="flex-1 bg-bg pt-14 px-5 items-center">
        <View className="w-full max-w-2xl flex-1">
          {/* Top Bar */}
          <View className="flex-row items-center justify-between mb-3">
            <TouchableOpacity onPress={handleExit} className="flex-row items-center p-1">
              <Ionicons name="close-circle-outline" size={20} color={c.warning} />
              <Text className="text-warning text-xs font-black uppercase ml-1">Beenden</Text>
            </TouchableOpacity>

            <View className="items-center">
              <Text className="text-content text-xs font-black uppercase tracking-wider">
                {meta.title}
              </Text>
              <Text className="text-content-faint text-[9px] font-bold">Raum: {roomCode}</Text>
            </View>

            <View className="items-center mb-1">
              <ProofPhotoButton context={meta.title} />
            </View>
          </View>

          {/* Team-HP — bewegt sich jetzt wirklich, weil der Server rechnet. */}
          {healthPoints !== undefined && (
            <View className="bg-surface border border-line rounded-2xl p-2.5 mb-3 flex-row items-center justify-between">
              <View className="flex-row items-center">
                <Ionicons name="heart" size={16} color={c.danger} />
                <Text className="text-content text-xs font-black ml-1.5">Team-HP</Text>
              </View>
              <View className="flex-1 mx-3 h-2 bg-bg rounded-full overflow-hidden">
                <View
                  style={{ width: `${Math.max(0, Math.min(100, healthPoints))}%` }}
                  className={`h-full rounded-full ${
                    healthPoints > 40 ? "bg-success" : "bg-danger"
                  }`}
                />
              </View>
              <Text className="text-content text-xs font-black">{healthPoints}%</Text>
            </View>
          )}

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Geheime Rolle */}
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
                  <View className="flex-row items-center flex-1 mr-2">
                    <Ionicons
                      name={showSecretRole ? "eye-outline" : "eye-off-outline"}
                      size={18}
                      color={c.accent}
                    />
                    <Text className="text-accent text-xs font-black uppercase tracking-wider ml-2 flex-1">
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

            {isFinale && finale ? (
              /* ── FINALE ─────────────────────────────────────────────── */
              <View className="bg-surface border-2 border-accent rounded-3xl p-6 shadow-2xl mb-6 items-center">
                <View className="w-14 h-14 rounded-full bg-accent/20 border border-accent items-center justify-center mb-3">
                  <Ionicons name="trophy" size={28} color={c.accent} />
                </View>
                <Text className="text-accent text-[10px] font-black uppercase tracking-widest mb-1">
                  {finale.title}
                </Text>
                <Text className="text-content text-xl font-black text-center mb-2">
                  {finale.winnerTeam}
                </Text>
                <Text className="text-content-faint text-xs font-medium text-center leading-relaxed mb-5">
                  {finale.summary}
                </Text>

                {claimedPoints !== null && (
                  <View className="w-full bg-success/10 border border-success/30 rounded-2xl p-3 mb-4 flex-row items-center justify-center">
                    <Ionicons name="star" size={16} color={c.success} />
                    <Text className="text-success text-xs font-black ml-2">
                      +{claimedPoints} XP für dein Profil
                    </Text>
                  </View>
                )}

                <View className="w-full bg-bg border border-line rounded-2xl p-4">
                  <Text className="text-content-faint text-[10px] font-black uppercase tracking-wider mb-2.5">
                    Trink-Urteile 🍻
                  </Text>
                  {finale.drinkPenalties.map((penalty, idx) => (
                    <View
                      key={idx}
                      className="flex-row items-center justify-between py-1.5 border-b border-line last:border-0"
                    >
                      <View className="flex-1 mr-2">
                        <Text className="text-content text-xs font-bold">{penalty.playerName}</Text>
                        <Text className="text-content-faint text-[9px]">{penalty.reason}</Text>
                      </View>
                      <View className="bg-danger/20 px-2 py-0.5 rounded-md">
                        <Text className="text-danger text-xs font-black">
                          {penalty.sips}x Schluck
                        </Text>
                      </View>
                    </View>
                  ))}
                  <Text className="text-content-faint text-[9px] font-medium mt-3 leading-relaxed">
                    Wasser zählt genauso. Wer aussetzen will, setzt aus.
                  </Text>
                </View>
              </View>
            ) : (
              /* ── KAPITEL ────────────────────────────────────────────── */
              <View>
                {chapter && (
                  <View className="bg-surface border border-line rounded-3xl p-6 shadow-xl mb-4">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-accent text-[10px] font-black uppercase tracking-wider flex-1 mr-2">
                        {chapter.title}
                      </Text>
                      <View className="bg-bg px-2 py-0.5 rounded-full border border-line">
                        <Text className="text-content-faint text-[9px] font-bold">
                          Akt {chapter.act}
                        </Text>
                      </View>
                    </View>

                    <Text className="text-content text-base font-bold leading-relaxed mb-3">
                      {chapter.text}
                    </Text>

                    {chapter.atmosphereHint && (
                      <Text className="text-content-faint text-[11px] italic font-medium">
                        &quot;{chapter.atmosphereHint}&quot;
                      </Text>
                    )}
                  </View>
                )}

                {error && (
                  <View className="bg-danger/10 border border-danger/30 p-3.5 rounded-2xl mb-4 flex-row items-center">
                    <Ionicons name="alert-circle" size={18} color={c.danger} />
                    <Text className="text-danger text-xs font-bold ml-2 flex-1">{error}</Text>
                  </View>
                )}

                {/* Ergebnis der eigenen Auswahl — kommt vom Server und
                    ueberlebt damit auch einen Reconnect. */}
                {myChoice && (
                  <View className="bg-success/10 border border-success/30 p-3.5 rounded-2xl mb-4 flex-row items-center">
                    <Ionicons name="checkmark-circle" size={18} color={c.success} />
                    <Text className="text-success text-xs font-bold ml-2 flex-1">
                      {myChoice.outcomeText}
                    </Text>
                  </View>
                )}

                {/* Ziel-Auswahl fuer Optionen, die jemanden bestimmen */}
                {pendingChoice && (
                  <View className="bg-surface border-2 border-accent/50 rounded-3xl p-5 mb-4 shadow-lg">
                    <Text className="text-content text-xs font-black uppercase tracking-wide mb-1">
                      Wen trifft es?
                    </Text>
                    <Text className="text-content-faint text-[11px] font-medium mb-3">
                      {pendingChoice.label}
                    </Text>
                    <View className="gap-2">
                      {others.map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          activeOpacity={0.85}
                          disabled={busy}
                          onPress={() => chooseOption(pendingChoice, p.id)}
                          className="bg-bg border border-line p-3 rounded-xl flex-row items-center justify-between"
                        >
                          <Text className="text-content text-xs font-bold">{p.name}</Text>
                          <Ionicons name="arrow-forward" size={14} color={c.accent} />
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity onPress={() => setPendingChoice(null)} className="mt-3 py-2">
                      <Text className="text-content-faint text-[11px] font-bold text-center">
                        Doch etwas anderes wählen
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Auswahl des Kapitels */}
                {chapter?.prompt && !myChoice && !pendingChoice && (
                  <View className="bg-surface border border-line rounded-3xl p-5 mb-4 shadow-lg">
                    <Text className="text-content text-xs font-black uppercase tracking-wide mb-1">
                      {chapter.prompt.title}
                    </Text>
                    <Text className="text-content-faint text-[11px] font-medium mb-3">
                      {chapter.prompt.description}
                    </Text>

                    <View className="gap-2">
                      {chapter.prompt.choices.map((choice) => (
                        <TouchableOpacity
                          key={choice.id}
                          activeOpacity={0.85}
                          disabled={busy}
                          onPress={() => chooseOption(choice)}
                          className="bg-bg border border-line p-3 rounded-xl flex-row items-center justify-between active:border-accent"
                        >
                          <Text className="text-content text-xs font-bold flex-1 mr-2">
                            {choice.label}
                          </Text>
                          <Ionicons
                            name={choice.targetRequired ? "person-add-outline" : "arrow-forward"}
                            size={14}
                            color={c.accent}
                          />
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Wer ist schon durch? Ohne zu verraten, womit. */}
                {chapter?.prompt && (
                  <Text className="text-content-faint text-[10px] font-black uppercase tracking-widest text-center mb-4">
                    {chosenCount} von {totalPlayers} haben entschieden
                  </Text>
                )}

                {/* Abstimmung */}
                {chapter?.voting && (
                  <View className="bg-surface border-2 border-warning/40 rounded-3xl p-5 mb-4 shadow-xl">
                    <View className="flex-row items-center mb-1">
                      <Ionicons name="finger-print" size={16} color={c.warning} />
                      <Text className="text-warning text-xs font-black uppercase tracking-wider ml-1.5">
                        Abstimmung
                      </Text>
                    </View>
                    <Text className="text-content text-sm font-black mb-3">
                      {chapter.voting.prompt}
                    </Text>

                    <View className="gap-2">
                      {others.map((candidate) => {
                        const isSelected = selectedVoteTarget === candidate.id;
                        return (
                          <TouchableOpacity
                            key={candidate.id}
                            activeOpacity={0.85}
                            onPress={() => handleVote(candidate.id)}
                            className={`flex-row items-center justify-between p-3 rounded-xl border ${
                              isSelected ? "bg-warning/20 border-warning" : "bg-bg border-line"
                            }`}
                          >
                            <View className="flex-row items-center">
                              <View className="w-7 h-7 rounded-full bg-surface border border-line items-center justify-center mr-2.5 overflow-hidden">
                                {candidate.avatar ? (
                                  <Image
                                    source={{ uri: candidate.avatar }}
                                    className="w-full h-full"
                                  />
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

                    <Text className="text-content-faint text-[10px] font-bold text-center mt-3">
                      {room?.gameState?.voteCount || 0} von {totalPlayers} haben abgestimmt
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Host-Leiste */}
          <View className="py-4 border-t border-line">
            {isHost ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={isFinale ? handleExit : handleNext}
                disabled={busy}
                className="w-full bg-accent py-4 rounded-2xl items-center justify-center flex-row shadow-lg disabled:opacity-40"
              >
                {busy ? (
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
      </View>
    </Modal>
  );
}
