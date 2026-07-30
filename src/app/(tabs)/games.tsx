import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Animated as RNAnimated,
  Easing as RNEasing,
  Image,
  Dimensions,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { User, Duel, Group } from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "@/services/config";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Card deck helper for Higher or Lower & Skull
export interface Card {
  suit: "♥" | "♦" | "♣" | "♠";
  value: number; // 2 to 14 (Jack=11, Queen=12, King=13, Ace=14)
  label: string;
}

// Scoreboard row returned by /api/scoreboard
export interface ScoreboardRow {
  id: string;
  username: string;
  currentLevel?: number;
  level?: number;
  title?: string;
  points?: number;
}

const SUITS: Card["suit"][] = ["♥", "♦", "♣", "♠"];
const VALUES = [
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
  { value: 6, label: "6" },
  { value: 7, label: "7" },
  { value: 8, label: "8" },
  { value: 9, label: "9" },
  { value: 10, label: "10" },
  { value: 11, label: "J" },
  { value: 12, label: "Q" },
  { value: 13, label: "K" },
  { value: 14, label: "A" },
];

const generateDeck = (): Card[] => {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const val of VALUES) {
      deck.push({ suit, value: val.value, label: val.label });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
};

// Decks for "Wahrheit oder Pflicht" (Truth or Dare)
const TRUTHS: string[] = [
  "Was ist das Peinlichste, das du betrunken getan hast?",
  "Wer in dieser Runde schaut am ehesten zu tief ins Glas?",
  "Was war deine dümmste Ausrede, um eine Verabredung abzusagen?",
  "Hast du jemals das Getränk von jemand anderem heimlich getrunken?",
  "Was ist deine geheime Lieblingsband, die dir peinlich ist?",
  "Mit wem in diesem Raum würdest du am ehesten auf einer einsamen Insel stranden wollen?",
  "Was war der schlechteste Anmachspruch, den du je benutzt hast?",
];

const DARES: string[] = [
  "Trinke, ohne deine Hände zu benutzen.",
  "Mache den Ententanz für 30 Sekunden.",
  "Erzähle einen extrem schlechten Witz. Wenn niemand lacht, musst du trinken.",
  "Tausche dein Oberteil mit der Person links von dir (oder trinke).",
  "Sprich für die nächsten 2 Runden mit einem ausländischen Akzent.",
  "Mach der Person gegenüber von dir ein übertriebenes Kompliment.",
  "Versuche, 30 Sekunden lang auf einem Bein zu stehen und dabei ein Trinklied zu singen.",
];

// Skull card rules
export interface SkullRule {
  value: string;
  name: string;
  desc: string;
}

const SKULL_RULES_NORMAL: Record<string, SkullRule> = {
  "2": { value: "2", name: "Wahl", desc: "Du darfst trinken an andere Spieler verteilen." },
  "3": { value: "3", name: "Selbst", desc: "Du musst trinken!" },
  "4": { value: "4", name: "Boden", desc: "Alle berühren den Boden. Der Letzte muss trinken." },
  "5": { value: "5", name: "Männer", desc: "Alle Männer in der Runde müssen trinken." },
  "6": { value: "6", name: "Frauen", desc: "Alle Frauen in der Runde müssen trinken." },
  "7": { value: "7", name: "Himmel", desc: "Alle strecken die Arme in die Luft. Der Letzte muss trinken." },
  "8": { value: "8", name: "Kumpel", desc: "Wähle einen Trink-Kumpanen. Er muss immer trinken, wenn du trinkst." },
  "9": { value: "9", name: "Reimrunde", desc: "Sage ein Wort. Die Runde reimt im Kreis. Wer zögert oder patzt, trinkt." },
  "10": { value: "10", name: "Kategorie", desc: "Nenne eine Kategorie (z.B. Automarken). Wer nichts mehr weiß, trinkt." },
  "J": { value: "J", name: "Regel", desc: "Stelle eine neue Regel auf (z.B. Keine Vornamen). Wer sie bricht, trinkt." },
  "Q": { value: "Q", name: "Fragekönig", desc: "Wer deine Fragen beantwortet, muss trinken. Du bist Fragekönig, bis die nächste Dame kommt." },
  "K": { value: "K", name: "Gemeinschaftsbecher", desc: "Gieße einen Schluck in den Gemeinschaftsbecher. Der vierte König trinkt den Becher aus!" },
  "A": { value: "A", name: "Wasserfall", desc: "Alle trinken. Du fängst an. Erst wenn dein Nachbar aufhört, darfst du aufhören." },
};

const SKULL_RULES_HARDCORE: Record<string, SkullRule> = {
  "2": { value: "2", name: "Doppel-Verteiler", desc: "Verteile trinken doppelt auf deine Freunde." },
  "3": { value: "3", name: "Vernichtung", desc: "Nimm selbst einen kräftigen Schluck!" },
  "4": { value: "4", name: "Boden-Strafstoß", desc: "Der Letzte am Boden muss trinken." },
  "5": { value: "5", name: "Herrenrunde", desc: "Männer trinken und machen 5 Liegestütze." },
  "6": { value: "6", name: "Damenkränzchen", desc: "Frauen trinken und bestimmen ein Opfer." },
  "7": { value: "7", name: "Flaschenzug", desc: "Der Letzte nimmt einen großen Schluck direkt aus dem Becher." },
  "8": { value: "8", name: "Teufelspakt", desc: "Wähle 2 Kumpel. Beide müssen ab jetzt immer mittrinken, wenn du trinkst." },
  "9": { value: "9", name: "Scharfe Reimrunde", desc: "Reimen im Kreis, aber das Tempo ist hoch. Verlierer trinkt." },
  "10": { value: "10", name: "Hardcore-Kategorie", desc: "Kategorie-Wahl, Verlierer trinkt." },
  "J": { value: "J", name: "Diktator", desc: "Erstelle eine Regel. Wer sie bricht, muss trinken!" },
  "Q": { value: "Q", name: "Beichtstuhl", desc: "Beantworte eine extrem intime Frage der Gruppe oder trinke." },
  "K": { value: "K", name: "Königs-Ex", desc: "Wer den König zieht, muss ein Getränk holen und trinken!" },
  "A": { value: "A", name: "Hardcore-Wasserfall", desc: "Wasserfall, aber jeder muss mindestens 5 Sekunden länger trinken als sein Vordermann." },
};

const SKULL_RULES_SPICY: Record<string, SkullRule> = {
  "2": { value: "2", name: "Wahl der Begierde", desc: "Wen in der Runde findest du am attraktivsten? Er/Sie muss trinken." },
  "3": { value: "3", name: "Körperkontakt", desc: "Halte Händchen mit deinem Nachbarn für die nächsten 2 Runden oder trinke." },
  "4": { value: "4", name: "Kleider-Poker", desc: "Ziehe ein Kleidungsstück aus oder trinke." },
  "5": { value: "5", name: "Sexting-Beichte", desc: "Lies deine letzte WhatsApp-Nachricht mit sexuellem Inhalt vor oder trinke." },
  "6": { value: "6", name: "Trocken-Tanz", desc: "Mache einen Lapdance für 15 Sekunden bei der Person gegenüber oder trinke." },
  "7": { value: "7", name: "Kuschelrunde", desc: "Umarme jemanden in der Runde für 10 Sekunden ganz fest oder trinke." },
  "8": { value: "8", name: "Kuss-Flasche", desc: "Gib der Person links von dir einen Kuss auf die Wange oder trinke." },
  "9": { value: "9", name: "Erotische Beichte", desc: "Erzähle von deiner wildesten Fantasie oder nimm einen großen Schluck!" },
  "10": { value: "10", name: "Wahrheit oder Trinken", desc: "Wer in der Runde hatte die meiste Erfahrung? Nenne eine Zahl oder trinke." },
  "J": { value: "J", name: "Heiße Berührung", desc: "Massiere dem Spieler rechts von dir die Schultern für 1 Minute oder trinke." },
  "Q": { value: "Q", name: "Dirty Talk", desc: "Mache einer Person deiner Wahl ein unanständiges Kompliment oder trinke." },
  "K": { value: "K", name: "Erotische Stimme", desc: "Stöhne einmal laut wie im Film oder trinke." },
  "A": { value: "A", name: "Strip-Wasserfall", desc: "Wasserfall, bei dem der Erste, der aufhört zu trinken, ein Kleidungsstück abgeben muss." },
};

export interface GamePlayer {
  id: string;
  name: string;
  avatar?: string | null;
  isGuest: boolean;
}

export interface SavedGameState {
  activeFullscreenGame: "duels" | "cards" | "higherlower" | "truth" | null;
  lobbyGameSelected: "cards" | "higherlower" | "truth" | null;
  runningGame: "cards" | "higherlower" | "truth" | null;
  players: GamePlayer[];
  todGameStarted: boolean;
  todSelectedPlayerId: string | null;
  todType: "truth" | "dare" | null;
  todIndex: number;

  hlStatus: "setup" | "playing" | "correct" | "gameover" | "passed";
  hlScore: number;
  hlDeck: Card[];
  hlCurrentCard: Card | null;
  hlRevealCard: Card | null;
  hlGuess: "higher" | "lower" | "equal" | null;

  skullStatus: "setup" | "drawn";
  skullMode: "normal" | "hardcore" | "spicy";
  skullDeck: Card[];
  currentSkullCard: Card | null;
}

export default function GamesScreen() {
  const [activeFullscreenGame, setActiveFullscreenGame] = useState<"duels" | "cards" | "higherlower" | "truth" | null>(null);
  const [lobbyGameSelected, setLobbyGameSelected] = useState<"cards" | "higherlower" | "truth" | null>(null);
  const [runningGame, setRunningGame] = useState<"cards" | "higherlower" | "truth" | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [friendsList, setFriendsList] = useState<User[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [duels, setDuels] = useState<Duel[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // Lobby state
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [guestNameInput, setGuestNameInput] = useState("");
  const [showFriendSelector, setShowFriendSelector] = useState(false);

  // 1v1 Duels Creator state
  const [showCreateDuel, setShowCreateDuel] = useState(false);
  const [selectedOpponentId, setSelectedOpponentId] = useState("");
  const [duelDuration, setDuelDuration] = useState("120"); // 2 hours

  // Truth or Dare states
  const [todGameStarted, setTodGameStarted] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<GamePlayer | null>(null);
  const [todType, setTodType] = useState<"truth" | "dare" | null>(null);
  const [todIndex, setTodIndex] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);

  // Animated values
  const spinAnim = useRef(new RNAnimated.Value(0)).current;
  const currentRotationValRef = useRef(0);
  const pulseScale = useRef(new RNAnimated.Value(1.0)).current;
  const isMountedRef = useRef(true);

  // Higher or Lower states
  const [hlDeck, setHlDeck] = useState<Card[]>([]);
  const [hlCurrentCard, setHlCurrentCard] = useState<Card | null>(null);
  const [hlScore, setHlScore] = useState(0);
  const [hlStatus, setHlStatus] = useState<"setup" | "playing" | "correct" | "gameover" | "passed">("setup");
  const [hlGuess, setHlGuess] = useState<"higher" | "lower" | "equal" | null>(null);
  const [hlRevealCard, setHlRevealCard] = useState<Card | null>(null);
  const [showHlWrongModal, setShowHlWrongModal] = useState(false);

  // Skull Card Game states
  const [skullMode, setSkullMode] = useState<"normal" | "hardcore" | "spicy">("normal");
  const [skullDeck, setSkullDeck] = useState<Card[]>([]);
  const [currentSkullCard, setCurrentSkullCard] = useState<Card | null>(null);
  const [skullStatus, setSkullStatus] = useState<"setup" | "drawn">("setup");

  // Cancellation confirmation
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Component Mount Lifecycle for Animation Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      spinAnim.stopAnimation();
      pulseScale.stopAnimation();
    };
  }, []);

  // Load preferences and game state on mount
  const loadInitialData = async () => {
    // 1. Load Saved Game State first (fast and offline safe)
    try {
      const json = await AsyncStorage.getItem("trinkduell_party_game_state");
      if (json) {
        const state: SavedGameState = JSON.parse(json);
        setActiveFullscreenGame(state.activeFullscreenGame);
        setLobbyGameSelected(state.lobbyGameSelected);
        setRunningGame(state.runningGame || null);
        const restoredPlayers = Array.isArray(state.players) ? state.players : [];
        setPlayers(restoredPlayers);
        setTodGameStarted(state.todGameStarted || false);

        // Find player in the loaded list safely
        if (state.todSelectedPlayerId) {
          const matched = restoredPlayers.find((p) => p.id === state.todSelectedPlayerId);
          setSelectedPlayer(matched || null);
        } else {
          setSelectedPlayer(null);
        }

        setTodType(state.todType || null);
        setTodIndex(state.todIndex || 0);

        setHlStatus(state.hlStatus || "setup");
        setHlScore(state.hlScore || 0);
        setHlDeck(state.hlDeck || []);
        setHlCurrentCard(state.hlCurrentCard || null);
        setHlRevealCard(state.hlRevealCard || null);
        setHlGuess(state.hlGuess || null);
        setShowHlWrongModal(state.hlStatus === "gameover");

        setSkullStatus(state.skullStatus || "setup");
        setSkullMode(state.skullMode || "normal");
        setSkullDeck(state.skullDeck || []);
        setCurrentSkullCard(state.currentSkullCard || null);
      }
    } catch (error) {
      console.error("Failed to load saved game state:", error);
    } finally {
      setLoading(false);
    }

    // 2. Fetch server-side data with null safety and fallbacks
    try {
      const me = await apiService.getCurrentUser().catch(() => null);
      const allUsers = await apiService.getUsers().catch(() => []);
      const allDuels = await apiService.getDuels().catch(() => []);
      const allGroups = await apiService.getGroups().catch(() => []);

      // Build safe fallback current user if me is null
      const currentUserObj: User = me || {
        id: "guest-user",
        name: "Spieler",
        avatar: undefined,
        rank: "Bronze",
        level: 1,
        currentLevel: 1,
        title: "Neuling",
        points: 0,
        alcoholGrams: 0,
        achievements: [],
      };

      // Fetch scoreboard to obtain dynamic level and title information
      let scoreboardRows: ScoreboardRow[] = [];
      try {
        const token = await AsyncStorage.getItem("trinkduell_v2_jwt_token");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        } else if (currentUserObj) {
          headers["Authorization"] = `Bearer mock-jwt-token-${currentUserObj.id}`;
        }

        const scoreboardResponse = await fetch(`${API_URL}/api/scoreboard`, {
          method: "GET",
          headers,
        });
        if (scoreboardResponse.ok) {
          const scoreboardData = await scoreboardResponse.json();
          if (scoreboardData && Array.isArray(scoreboardData)) {
            scoreboardRows = scoreboardData;
          } else if (scoreboardData && Array.isArray(scoreboardData.rows)) {
            scoreboardRows = scoreboardData.rows;
          }
        }
      } catch (err) {
        console.warn("Could not fetch scoreboard in games screen, using offline fallbacks:", err);
      }

      // Enrich users with levels and titles from scoreboard
      const enrichedUsers = allUsers.map((u) => {
        const sbUser = scoreboardRows.find((su) => su.id === u.id || su.username === u.name);
        return {
          ...u,
          currentLevel: sbUser?.currentLevel || sbUser?.level || u.currentLevel || u.level || 1,
          title: sbUser?.title || u.title || "Neuling",
        };
      });

      const meSbUser = scoreboardRows.find((su) => su.id === currentUserObj.id || su.username === currentUserObj.name);
      const enrichedCurrentUser: User = {
        ...currentUserObj,
        currentLevel: meSbUser?.currentLevel || meSbUser?.level || currentUserObj.currentLevel || currentUserObj.level || 1,
        title: meSbUser?.title || currentUserObj.title || "Neuling",
      };

      setCurrentUser(enrichedCurrentUser);
      setUsers(enrichedUsers.filter((u) => u.id !== currentUserObj.id));
      setDuels(allDuels);
      setGroups(allGroups);

      if (enrichedUsers.length > 0 && !selectedOpponentId) {
        const firstOpponent = enrichedUsers.find((u) => u.id !== currentUserObj.id);
        if (firstOpponent) setSelectedOpponentId(firstOpponent.id);
      }
    } catch (error) {
      console.warn("Failed to load server-side data in games screen, using offline fallbacks:", error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadInitialData();
    }, [])
  );

  // Global State Persistence Auto-Save Effect
  useEffect(() => {
    if (loading) return;
    const saveState = async () => {
      try {
        const state: SavedGameState = {
          activeFullscreenGame,
          lobbyGameSelected,
          runningGame,
          players,
          todGameStarted,
          todSelectedPlayerId: selectedPlayer ? selectedPlayer.id : null,
          todType,
          todIndex,
          hlStatus,
          hlScore,
          hlDeck,
          hlCurrentCard,
          hlRevealCard,
          hlGuess,
          skullStatus,
          skullMode,
          skullDeck,
          currentSkullCard,
        };
        await AsyncStorage.setItem("trinkduell_party_game_state", JSON.stringify(state));
      } catch (e) {
        console.warn("Failed to persist game state:", e);
      }
    };
    saveState();
  }, [
    activeFullscreenGame,
    lobbyGameSelected,
    runningGame,
    players,
    todGameStarted,
    selectedPlayer,
    todType,
    todIndex,
    hlStatus,
    hlScore,
    hlDeck,
    hlCurrentCard,
    hlRevealCard,
    hlGuess,
    skullStatus,
    skullMode,
    skullDeck,
    currentSkullCard,
    loading,
  ]);

  // Pulse Selected Player effect — with cleanup return to prevent memory leaks
  useEffect(() => {
    let anim: RNAnimated.CompositeAnimation | null = null;
    if (selectedPlayer) {
      pulseScale.setValue(1.0);
      anim = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(pulseScale, {
            toValue: 1.15,
            duration: 500,
            easing: RNEasing.inOut(RNEasing.ease),
            useNativeDriver: true,
          }),
          RNAnimated.timing(pulseScale, {
            toValue: 1.0,
            duration: 500,
            easing: RNEasing.inOut(RNEasing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      anim.start();
    } else {
      pulseScale.setValue(1.0);
    }
    return () => {
      anim?.stop();
    };
  }, [selectedPlayer]);

  // Platform-Safe Confirm Game Cancellation
  const performCancelGame = async () => {
    await triggerHaptic("medium");

    // Reset all game states
    setActiveFullscreenGame(null);
    setLobbyGameSelected(null);
    setRunningGame(null);
    setPlayers([]);
    setTodGameStarted(false);
    setSelectedPlayer(null);
    setTodType(null);
    setTodIndex(0);

    setHlStatus("setup");
    setHlScore(0);
    setHlDeck([]);
    setHlCurrentCard(null);
    setHlRevealCard(null);
    setHlGuess(null);
    setShowHlWrongModal(false);

    setSkullStatus("setup");
    setSkullMode("normal");
    setSkullDeck([]);
    setCurrentSkullCard(null);

    await AsyncStorage.removeItem("trinkduell_party_game_state");
  };

  const renderCancelConfirmOverlay = () => {
    if (!showCancelConfirm) return null;
    return (
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(2, 6, 23, 0.9)",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 999,
        }}
        className="px-6"
      >
        <View className="bg-slate-900 border border-purple-500/30 w-full max-w-[320px] rounded-3xl p-6 items-center shadow-2xl">
          <Ionicons name="warning-outline" size={48} color="#a855f7" style={{ marginBottom: 16 }} />
          <Text className="text-white text-base font-black uppercase tracking-wider text-center mb-2">
            Spiel abbrechen?
          </Text>
          <Text className="text-slate-400 text-xs font-medium text-center mb-6 leading-relaxed">
            Möchtest du das aktuelle Spiel wirklich beenden? Alle Spieler und der gesamte Spielstand werden gelöscht.
          </Text>
          <View className="flex-row space-x-3 w-full">
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                setShowCancelConfirm(false);
              }}
              className="flex-1 bg-slate-950 border border-white/5 py-3.5 rounded-2xl items-center"
            >
              <Text className="text-slate-400 font-bold text-xs uppercase tracking-wider">Nein</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                setShowCancelConfirm(false);
                await performCancelGame();
              }}
              className="flex-1 bg-purple-500 py-3.5 rounded-2xl items-center shadow active:scale-95"
            >
              <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Ja, abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const loadFriendsForLobby = async () => {
    if (!currentUser) return;
    setFriendsLoading(true);
    try {
      const data = await apiService.getFriends(currentUser.name);
      setFriendsList(data.friends || []);
    } catch (error) {
      console.warn("Failed to load friends in lobby selector:", error);
    } finally {
      setFriendsLoading(false);
    }
  };

  // Lobby actions
  const addGuestPlayer = () => {
    if (!guestNameInput.trim()) return;
    triggerHaptic("light");
    const name = guestNameInput.trim();
    if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert("Info", "Ein Spieler mit diesem Namen ist bereits in der Lobby.");
      return;
    }
    setPlayers((prev) => [
      ...prev,
      {
        id: `guest-${Date.now()}-${Math.random()}`,
        name,
        isGuest: true,
      },
    ]);
    setGuestNameInput("");
  };

  const addFriendPlayer = (friend: User) => {
    triggerHaptic("light");
    if (players.some((p) => p.id === friend.id)) {
      Alert.alert("Info", "Dieser Spieler ist bereits in der Lobby.");
      return;
    }
    setPlayers((prev) => [
      ...prev,
      {
        id: friend.id,
        name: friend.name,
        avatar: friend.avatar,
        isGuest: false,
      },
    ]);
    setShowFriendSelector(false);
  };

  const removePlayer = (id: string) => {
    triggerHaptic("medium");
    setPlayers((prev) => prev.filter((p) => p.id !== id));
    if (selectedPlayer?.id === id) {
      setSelectedPlayer(null);
    }
  };

  const startSelectedGame = () => {
    if (players.length < 2) {
      Alert.alert("Lobby unvollständig", "Es müssen mindestens 2 Spieler in der Lobby sein!");
      return;
    }
    triggerHaptic("success");

    if (lobbyGameSelected === "higherlower") {
      startHigherLower();
    } else if (lobbyGameSelected === "cards") {
      startSkullGame();
    } else if (lobbyGameSelected === "truth") {
      setTodGameStarted(true);
      setRunningGame("truth");
      setActiveFullscreenGame("truth");
    }
  };

  // 1v1 Duels Challenge Actions
  const handleCreateDuel = async () => {
    if (!selectedOpponentId) {
      Alert.alert("Fehler", "Bitte wähle einen Gegner aus.");
      return;
    }

    try {
      await triggerHaptic("success");
      await apiService.createDuel(selectedOpponentId, parseInt(duelDuration, 10));
      setShowCreateDuel(false);
      await loadInitialData();
      Alert.alert("Herausforderung gesendet!", "Dein Gegner muss das Duell jetzt annehmen.");
    } catch (e) {
      await triggerHaptic("error");
      Alert.alert("Fehler", "Duell konnte nicht gestartet werden.");
    }
  };

  const handleAcceptDuel = async (duelId: string) => {
    try {
      await triggerHaptic("success");
      await apiService.acceptDuel(duelId);
      await loadInitialData();
    } catch (e) {
      await triggerHaptic("error");
      Alert.alert("Fehler", "Konnte das Duell nicht annehmen.");
    }
  };

  // Truth or Dare actions with safe animation completion
  const spinBottle = () => {
    if (isSpinning || players.length === 0) return;

    triggerHaptic("medium");
    setIsSpinning(true);
    setSelectedPlayer(null);
    setTodType(null);

    const randomIndex = Math.floor(Math.random() * players.length);
    const R = 6; // 6 full spins
    const playerAngle = (randomIndex * 360) / players.length;
    const targetAngle = 360 * R + playerAngle;

    // Reset rotation angle modulo 360 to ensure clockwise rotation on repeat spins
    const lastAngle = currentRotationValRef.current % 360;
    spinAnim.setValue(lastAngle);
    currentRotationValRef.current = targetAngle;

    RNAnimated.timing(spinAnim, {
      toValue: targetAngle,
      duration: 2500,
      easing: RNEasing.out(RNEasing.cubic),
      useNativeDriver: true,
    }).start(async () => {
      if (!isMountedRef.current) return;
      await triggerHaptic("success");
      setIsSpinning(false);
      const chosen = players[randomIndex];
      if (chosen) {
        setSelectedPlayer(chosen);
        setTodIndex(Math.floor(Math.random() * TRUTHS.length));
      }
    });
  };

  const spinAngle = spinAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
  });

  // Higher or Lower actions
  const startHigherLower = () => {
    const deck = generateDeck();
    const firstCard = deck.pop()!;
    setHlDeck(deck);
    setHlCurrentCard(firstCard);
    setHlRevealCard(null);
    setHlScore(0);
    setHlStatus("playing");
    setShowHlWrongModal(false);

    setRunningGame("higherlower");
    setActiveFullscreenGame("higherlower");
  };

  const playHigherLower = (guess: "higher" | "lower" | "equal") => {
    if (!hlCurrentCard) return;
    triggerHaptic("light");

    let deckCopy = [...hlDeck];
    if (deckCopy.length === 0) {
      deckCopy = generateDeck();
    }
    const nextCard = deckCopy.pop()!;
    setHlDeck(deckCopy);
    setHlRevealCard(nextCard);
    setHlGuess(guess);

    const prevVal = hlCurrentCard.value;
    const nextVal = nextCard.value;

    let correct = false;
    if (guess === "higher" && nextVal > prevVal) correct = true;
    if (guess === "lower" && nextVal < prevVal) correct = true;
    if (guess === "equal" && nextVal === prevVal) correct = true;

    if (correct) {
      setHlStatus("correct");
    } else {
      setHlStatus("gameover");
      setShowHlWrongModal(true);
      triggerHaptic("error");
    }
  };

  const nextHigherLowerRound = () => {
    if (hlRevealCard) {
      triggerHaptic("success");
      setHlCurrentCard(hlRevealCard);
      setHlRevealCard(null);
      setHlScore((s) => s + 1);
      setHlGuess(null);
      setHlStatus("playing");
    }
  };

  const passHigherLower = () => {
    triggerHaptic("success");
    setHlStatus("passed");
  };

  const handleHlWrongModalDismiss = () => {
    triggerHaptic("light");
    setShowHlWrongModal(false);
    // Proceed seamlessly with the next card
    if (hlRevealCard) {
      setHlCurrentCard(hlRevealCard);
      setHlRevealCard(null);
      setHlGuess(null);
      setHlStatus("playing");
    }
  };

  // Skull Card Game actions
  const startSkullGame = () => {
    const deck = generateDeck();
    setSkullDeck(deck);
    setCurrentSkullCard(null);
    setSkullStatus("drawn");

    setRunningGame("cards");
    setActiveFullscreenGame("cards");
  };

  const drawSkullCard = () => {
    let deckCopy = [...skullDeck];
    if (deckCopy.length === 0) {
      deckCopy = generateDeck();
    }
    triggerHaptic("medium");
    const drawn = deckCopy.pop()!;
    setSkullDeck(deckCopy);
    setCurrentSkullCard(drawn);
    setSkullStatus("drawn");
  };

  const getSkullRule = (card: Card | null): SkullRule => {
    if (!card) return { value: "", name: "", desc: "" };
    const rules =
      skullMode === "hardcore"
        ? SKULL_RULES_HARDCORE
        : skullMode === "spicy"
        ? SKULL_RULES_SPICY
        : SKULL_RULES_NORMAL;

    return rules[card.label] || { value: card.label, name: "Aufgabe", desc: "Du musst trinken! 🍻" };
  };

  const getRemainingTimeText = (endTimeStr: string | null) => {
    if (!endTimeStr) return "-";
    const diff = new Date(endTimeStr).getTime() - Date.now();
    if (diff <= 0) return "Beendet";
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hours} Std. ${mins} Min.`;
  };

  if (loading || !currentUser) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#22d3ee" />
      </View>
    );
  }

  const activeSavedGameText = () => {
    if (runningGame === "higherlower") return "Höher oder Tiefer";
    if (runningGame === "cards") return "Skull Kartenspiel";
    if (runningGame === "truth") return "Wahrheit oder Pflicht";
    return null;
  };

  return (
    <View className="flex-1 bg-slate-950">
      {/* Lobby selector screen or Main Hub */}
      {lobbyGameSelected === null && activeFullscreenGame === null ? (
        <ScrollView className="flex-1 px-5 pt-4" showsVerticalScrollIndicator={false}>
          <Text className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 mt-2">
            Bereit für die Runde?
          </Text>
          <Text className="text-white text-xl font-black mb-6">Trinkspiele & Duelle 🎮</Text>

          {/* Active Saved Game Banner */}
          {runningGame !== null && (
            <View className="bg-slate-900 border border-purple-500/35 rounded-3xl p-5 mb-6 relative overflow-hidden shadow-lg">
              <Text className="text-purple-400 text-[9px] font-black uppercase tracking-widest mb-1">
                Spiel läuft noch! 🎮
              </Text>
              <Text className="text-white text-sm font-black mb-1">{activeSavedGameText()}</Text>
              <Text className="text-slate-500 text-[9.5px] font-medium leading-relaxed mb-4">
                Ein Spiel ist bereits aktiv. Möchtest du an derselben Stelle fortfahren oder abbrechen?
              </Text>
              <View className="flex-row space-x-3">
                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic("success");
                    if (runningGame) {
                      setActiveFullscreenGame(runningGame);
                    }
                  }}
                  className="flex-1 bg-purple-500 py-3 rounded-2xl items-center shadow"
                >
                  <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Fortsetzen</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowCancelConfirm(true)}
                  className="flex-1 bg-slate-950 border border-white/5 py-3 rounded-2xl items-center"
                >
                  <Text className="text-slate-400 font-black text-xs uppercase tracking-wider">Abbrechen</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View className="flex-row flex-wrap justify-between">
            {/* Tile 1: 1v1 point duels */}
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("medium");
                setActiveFullscreenGame("duels");
              }}
              className="w-[47%] bg-white/5 border border-cyan-500/20 rounded-3xl p-5 mb-5 shadow-lg items-start justify-between min-h-[160px]"
            >
              <View className="bg-cyan-500/10 p-3 rounded-2xl border border-cyan-500/20 mb-4">
                <Ionicons name="trophy-outline" size={24} color="#22d3ee" />
              </View>
              <View>
                <Text className="text-white text-xs font-black uppercase tracking-wider mb-1">1v1 Duell</Text>
                <Text className="text-slate-500 text-[9px] font-semibold leading-normal">
                  Fordere einen Freund zu einem Echtzeit-Punkterennen heraus.
                </Text>
              </View>
            </TouchableOpacity>

            {/* Tile 2: Higher Lower */}
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("medium");
                setLobbyGameSelected("higherlower");
              }}
              className="w-[47%] bg-white/5 border border-orange-500/20 rounded-3xl p-5 mb-5 shadow-lg items-start justify-between min-h-[160px]"
            >
              <View className="bg-orange-500/10 p-3 rounded-2xl border border-orange-500/20 mb-4">
                <Ionicons name="trending-up-outline" size={24} color="#fb923c" />
              </View>
              <View>
                <Text className="text-white text-xs font-black uppercase tracking-wider mb-1">Höher / Tiefer</Text>
                <Text className="text-slate-500 text-[9px] font-semibold leading-normal">
                  Errate Kartenwerte oder trinke bei Fehlern.
                </Text>
              </View>
            </TouchableOpacity>

            {/* Tile 3: Skull */}
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("medium");
                setLobbyGameSelected("cards");
              }}
              className="w-[47%] bg-white/5 border border-emerald-500/20 rounded-3xl p-5 mb-5 shadow-lg items-start justify-between min-h-[160px]"
            >
              <View className="bg-emerald-500/10 p-3 rounded-2xl border border-emerald-500/20 mb-4">
                <Ionicons name="albums-outline" size={24} color="#34d399" />
              </View>
              <View>
                <Text className="text-white text-xs font-black uppercase tracking-wider mb-1">Skull (Cards)</Text>
                <Text className="text-slate-500 text-[9px] font-semibold leading-normal">
                  Der Klassiker! Kartenspiel mit Aufgaben von Normal bis 18+.
                </Text>
              </View>
            </TouchableOpacity>

            {/* Tile 4: Truth or Dare */}
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("medium");
                setLobbyGameSelected("truth");
              }}
              className="w-[47%] bg-white/5 border border-purple-500/20 rounded-3xl p-5 mb-5 shadow-lg items-start justify-between min-h-[160px]"
            >
              <View className="bg-purple-500/10 p-3 rounded-2xl border border-purple-500/20 mb-4">
                <Ionicons name="wine-outline" size={24} color="#a855f7" />
              </View>
              <View>
                <Text className="text-white text-xs font-black uppercase tracking-wider mb-1">Wahrheit / Pflicht</Text>
                <Text className="text-slate-500 text-[9px] font-semibold leading-normal">
                  Flaschendrehen mit schlüpfrigen Fragen und witzigen Aufgaben.
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : activeFullscreenGame === null ? (
        /* ========================================================================= */
        /* PARTY LOBBY SCREEN (Setup players before launching the game)              */
        /* ========================================================================= */
        <View className="flex-1 bg-slate-950 pt-14 px-5">
          <View className="flex-row items-center justify-between mb-6">
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("medium");
                setLobbyGameSelected(null);
              }}
              className="flex-row items-center space-x-1 p-1"
            >
              <Ionicons name="arrow-back" size={20} color="#a855f7" />
              <Text className="text-purple-400 text-xs font-black uppercase ml-1">Zurück</Text>
            </TouchableOpacity>
            <Text className="text-white text-sm font-black uppercase tracking-wider">Party-Lobby 👥</Text>
            <View className="w-16" />
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="bg-slate-900/60 border border-white/5 rounded-3xl p-5 shadow-xl mb-6">
              <Text className="text-white text-xs font-black uppercase tracking-wider mb-1">
                Lobby vorbereiten
              </Text>
              <Text className="text-slate-500 text-[10px] font-semibold mb-4 leading-normal">
                Füge registrierte Freunde oder temporäre Abendgäste der Runde hinzu.
              </Text>

              {/* Add Guest Text input */}
              <View className="bg-slate-950/80 border border-white/5 rounded-2xl p-4 mb-4">
                <Text className="text-slate-400 text-[9px] font-black uppercase mb-2">
                  Gast hinzufügen (Temporär)
                </Text>
                <View className="flex-row space-x-2">
                  <TextInput
                    placeholder="Name eingeben..."
                    placeholderTextColor="#475569"
                    value={guestNameInput}
                    onChangeText={setGuestNameInput}
                    className="flex-1 bg-slate-900 border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs font-bold"
                  />
                  <TouchableOpacity
                    onPress={addGuestPlayer}
                    className="bg-purple-500 px-4 rounded-xl items-center justify-center"
                  >
                    <Ionicons name="add" size={18} color="#020617" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Choose from registered friends */}
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  setShowFriendSelector(true);
                  loadFriendsForLobby();
                }}
                className="bg-slate-950/80 border border-dashed border-purple-500/20 py-3.5 rounded-2xl flex-row items-center justify-center space-x-2 mb-6"
              >
                <Ionicons name="people-outline" size={16} color="#a855f7" />
                <Text className="text-purple-400 text-[10px] font-black uppercase tracking-wider">
                  Aus Freunden wählen
                </Text>
              </TouchableOpacity>

              {/* Player list */}
              <Text className="text-slate-400 text-[9px] font-black uppercase mb-3">
                Spieler in der Runde ({players.length})
              </Text>
              {players.length === 0 ? (
                <View className="py-8 bg-slate-950/40 border border-white/5 rounded-2xl items-center justify-center mb-6">
                  <Ionicons name="people-outline" size={28} color="#475569" className="mb-2" />
                  <Text className="text-slate-500 text-[10px] font-black tracking-wide uppercase text-center">
                    Noch keine Spieler eingetragen
                  </Text>
                </View>
              ) : (
                <View className="space-y-2.5 mb-6">
                  {players.map((p) => (
                    <View
                      key={p.id}
                      className="bg-slate-950/60 border border-white/5 rounded-2xl p-3.5 flex-row justify-between items-center"
                    >
                      <View className="flex-row items-center space-x-3">
                        {p.avatar ? (
                          <Image source={{ uri: p.avatar }} className="w-8 h-8 rounded-full border border-white/10" />
                        ) : (
                          <View className="w-8 h-8 rounded-full bg-slate-900 border border-white/5 items-center justify-center">
                            <Text className="text-white text-xs font-black">
                              {p.name.substring(0, 2).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View>
                          <Text className="text-white text-xs font-black">{p.name}</Text>
                          <Text className="text-slate-500 text-[7.5px] font-extrabold uppercase tracking-wider mt-0.5">
                            {p.isGuest ? "Temporärer Gast 👤" : "Registrierter User ⭐"}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => removePlayer(p.id)}
                        className="bg-red-500/10 border border-red-500/20 p-2 rounded-xl"
                      >
                        <Ionicons name="trash-outline" size={14} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* Start game button */}
              <TouchableOpacity
                onPress={startSelectedGame}
                disabled={players.length < 2}
                className={`w-full py-4 rounded-2xl items-center justify-center flex-row space-x-2 ${
                  players.length < 2 ? "bg-slate-800 opacity-40" : "bg-purple-500 active:scale-95"
                }`}
              >
                <Ionicons name="play" size={16} color="#020617" />
                <Text className="text-slate-950 font-black text-xs uppercase tracking-wider ml-1.5">
                  Spiel starten
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Modal Friend Selector */}
          <Modal visible={showFriendSelector} animationType="slide" transparent={true}>
            <View className="flex-1 bg-black/85 justify-end">
              <View className="bg-slate-900 border-t border-white/10 rounded-t-3xl p-5 pb-8 max-h-[70%]">
                <View className="flex-row justify-between items-center mb-5">
                  <Text className="text-white text-sm font-black uppercase tracking-wider">
                    Aus Freunden wählen
                  </Text>
                  <TouchableOpacity onPress={() => setShowFriendSelector(false)} className="p-1">
                    <Ionicons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <ScrollView className="space-y-2 mb-4">
                  {friendsLoading ? (
                    <ActivityIndicator size="large" color="#a855f7" className="py-6" />
                  ) : friendsList.length === 0 ? (
                    <Text className="text-slate-500 text-xs italic text-center py-6">
                      Keine Freunde gefunden. Füge Freunde über dein Profil hinzu!
                    </Text>
                  ) : (
                    friendsList.map((friend) => {
                      const alreadyInLobby = players.some((p) => p.id === friend.id);
                      return (
                        <TouchableOpacity
                          key={friend.id}
                          disabled={alreadyInLobby}
                          onPress={() => addFriendPlayer(friend)}
                          className={`p-3 rounded-2xl flex-row justify-between items-center mb-2 ${
                            alreadyInLobby
                              ? "bg-slate-950/20 opacity-40 border border-white/5"
                              : "bg-slate-950/60 border border-white/5"
                          }`}
                        >
                          <View className="flex-row items-center space-x-3">
                            {friend.avatar ? (
                              <Image source={{ uri: friend.avatar }} className="w-8 h-8 rounded-full border border-white/10" />
                            ) : (
                              <View className="w-8 h-8 rounded-full bg-slate-900 border border-white/5 items-center justify-center">
                                <Text className="text-white text-xs font-black">
                                  {friend.name.substring(0, 2).toUpperCase()}
                                </Text>
                              </View>
                            )}
                            <View>
                              <Text className="text-white text-xs font-black">{friend.name}</Text>
                              <Text className="text-cyan-400 text-[8px] font-bold mt-0.5">
                                Lv. {friend.currentLevel || friend.level || 1} - {friend.title || "Neuling"}
                              </Text>
                            </View>
                          </View>
                          {!alreadyInLobby && <Ionicons name="chevron-forward" size={14} color="#a855f7" />}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </View>
      ) : null}

      {/* ========================================================================= */}
      {/* GAME RUNNING PLAYING MODALS                                              */}
      {/* ========================================================================= */}

      {/* A. 1v1 DUELS OVERLAY */}
      <Modal visible={activeFullscreenGame === "duels"} animationType="slide" transparent={false}>
        <View className="flex-1 bg-slate-950 pt-14 px-5">
          <View className="flex-row items-center justify-between mb-6">
            <TouchableOpacity onPress={() => setActiveFullscreenGame(null)} className="flex-row items-center space-x-1 p-1">
              <Ionicons name="arrow-back" size={20} color="#22d3ee" />
              <Text className="text-cyan-400 text-xs font-black uppercase ml-1">Verlassen</Text>
            </TouchableOpacity>
            <Text className="text-white text-sm font-black uppercase tracking-wider">1v1 Duelle</Text>
            <View className="w-16" />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                setShowCreateDuel(true);
              }}
              className="bg-cyan-400 py-4.5 rounded-3xl items-center flex-row justify-center space-x-2 shadow-lg shadow-cyan-500/10 mb-6"
            >
              <Ionicons name="flash" size={18} color="#020617" />
              <Text className="text-slate-950 font-black text-xs uppercase tracking-wider ml-1.5">
                Freund herausfordern
              </Text>
            </TouchableOpacity>

            <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-3">Laufende Duelle</Text>
            {duels.length === 0 ? (
              <View className="bg-white/5 border border-white/5 rounded-3xl p-6 items-center mb-6">
                <Text className="text-slate-500 text-xs italic">Aktuell keine aktiven Duelle vorhanden.</Text>
              </View>
            ) : (
              duels.map((d) => {
                const isCreator = d.creatorId === currentUser?.id;
                const isOpponent = d.opponentId === currentUser?.id;

                const opponentUser = isCreator
                  ? users.find((u) => u.id === d.opponentId)
                  : users.find((u) => u.id === d.creatorId) || currentUser;

                return (
                  <View key={d.id} className="bg-white/5 border border-white/10 p-5 rounded-3xl mb-4">
                    <View className="flex-row justify-between items-center mb-3">
                      <View className="flex-row items-center space-x-2.5">
                        <Image
                          source={{
                            uri:
                              opponentUser?.avatar ||
                              "https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=150&q=80",
                          }}
                          className="w-9 h-9 rounded-full border border-white/10"
                        />
                        <View className="ml-2.5">
                          <Text className="text-white text-xs font-black">{opponentUser?.name}</Text>
                          <Text className="text-cyan-400 text-[8.5px] font-bold mt-0.5">
                            Lv. {opponentUser?.currentLevel || opponentUser?.level || 1} - {opponentUser?.title || "Neuling"}
                          </Text>
                          <Text className="text-slate-500 text-[8px] font-extrabold uppercase mt-0.5">
                            Status: {d.status === "pending" ? "Wartend" : "Aktiv ⏳"}
                          </Text>
                        </View>
                      </View>
                      <View className="bg-slate-900 px-2.5 py-1 rounded-xl">
                        <Text className="text-[8px] font-black text-cyan-400 uppercase">
                          Dauer: {d.duration} Min
                        </Text>
                      </View>
                    </View>

                    {d.status === "active" ? (
                      <View className="bg-slate-950 p-4 rounded-2xl border border-white/5">
                        <View className="flex-row justify-between mb-2">
                          <View className="items-start flex-1 mr-2">
                            <Text className="text-slate-500 text-[8px] font-black uppercase">Du</Text>
                            <Text className="text-cyan-400 text-[9px] font-bold" numberOfLines={1}>
                              Lv. {currentUser?.currentLevel || currentUser?.level || 1} - {currentUser?.title ?? "Neuling"}
                            </Text>
                          </View>
                          <View className="items-end flex-1 ml-2">
                            <Text className="text-slate-500 text-[8px] font-black uppercase">Gegner</Text>
                            <Text className="text-rose-400 text-[9px] font-bold" numberOfLines={1}>
                              Lv. {opponentUser?.currentLevel || opponentUser?.level || 1} - {opponentUser?.title}
                            </Text>
                          </View>
                        </View>
                        <View className="flex-row justify-between items-center mb-3">
                          <Text className="text-cyan-400 text-lg font-black">{isCreator ? d.creatorPoints : d.opponentPoints} XP</Text>
                          <Text className="text-white/30 text-xs">vs</Text>
                          <Text className="text-rose-500 text-lg font-black">{isCreator ? d.opponentPoints : d.creatorPoints} XP</Text>
                        </View>
                        <Text className="text-[9px] text-slate-500 font-bold text-center">
                          Verbleibende Zeit: {getRemainingTimeText(d.endTime)}
                        </Text>
                      </View>
                    ) : (
                      isOpponent && (
                        <TouchableOpacity
                          onPress={() => handleAcceptDuel(d.id)}
                          className="bg-purple-500 py-3 rounded-2xl items-center mt-2 shadow"
                        >
                          <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">
                            Duell annehmen ⚔️
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* B. HIGHER OR LOWER OVERLAY */}
      <Modal visible={activeFullscreenGame === "higherlower"} animationType="slide" transparent={false}>
        <View className="flex-1 bg-slate-950 pt-14 px-5">
          {renderCancelConfirmOverlay()}
          <View className="flex-row items-center justify-between mb-6">
            <TouchableOpacity onPress={() => setShowCancelConfirm(true)} className="flex-row items-center space-x-1 p-1">
              <Ionicons name="close-circle-outline" size={20} color="#fb923c" />
              <Text className="text-orange-400 text-xs font-black uppercase ml-1">Spiel abbrechen</Text>
            </TouchableOpacity>
            <Text className="text-white text-sm font-black uppercase tracking-wider">Höher oder Tiefer</Text>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                setActiveFullscreenGame(null);
                setLobbyGameSelected(null);
              }}
              className="flex-row items-center space-x-1 p-1"
            >
              <Ionicons name="home-outline" size={18} color="#64748b" />
              <Text className="text-slate-500 text-[10px] font-black uppercase ml-1">Minimieren</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-1 items-center justify-between pb-10">
            {/* Score indicator */}
            <View className="flex-row space-x-6 mt-4">
              <View className="bg-slate-900 border border-white/5 px-6 py-3 rounded-2xl items-center">
                <Text className="text-slate-500 text-[8px] font-black uppercase">Aktuelle Serie</Text>
                <Text className="text-white text-base font-black mt-0.5">{hlScore} 🔥</Text>
              </View>
            </View>

            {/* Cards Viewport */}
            <View className="flex-row space-x-6 items-center my-6">
              {/* Current Card */}
              {hlCurrentCard && (
                <View className="w-28 aspect-[5/7] bg-slate-900 border border-white/10 rounded-2xl p-4 justify-between items-center relative shadow-xl">
                  <View className="absolute top-2 left-3 flex-row items-center">
                    <Text className={`text-sm font-black ${["♥", "♦"].includes(hlCurrentCard.suit) ? "text-red-500" : "text-white"}`}>
                      {hlCurrentCard.label}
                    </Text>
                    <Text className={`text-xs ml-0.5 ${["♥", "♦"].includes(hlCurrentCard.suit) ? "text-red-500" : "text-slate-400"}`}>
                      {hlCurrentCard.suit}
                    </Text>
                  </View>
                  <View className="flex-1 items-center justify-center mt-3">
                    <Text className={`text-4xl ${["♥", "♦"].includes(hlCurrentCard.suit) ? "text-red-500" : "text-slate-300"}`}>
                      {hlCurrentCard.suit}
                    </Text>
                  </View>
                </View>
              )}

              <Text className="text-white/20 text-lg font-black">vs</Text>

              {/* Reveal Card / Hidden Card */}
              <View className="w-28 aspect-[5/7] bg-slate-900 border border-white/10 rounded-2xl p-4 justify-between items-center relative overflow-hidden shadow-xl">
                {hlRevealCard ? (
                  <>
                    <View className="absolute top-2 left-3 flex-row items-center">
                      <Text className={`text-sm font-black ${["♥", "♦"].includes(hlRevealCard.suit) ? "text-red-500" : "text-white"}`}>
                        {hlRevealCard.label}
                      </Text>
                      <Text className={`text-xs ml-0.5 ${["♥", "♦"].includes(hlRevealCard.suit) ? "text-red-500" : "text-slate-400"}`}>
                        {hlRevealCard.suit}
                      </Text>
                    </View>
                    <View className="flex-1 items-center justify-center mt-3">
                      <Text className={`text-4xl ${["♥", "♦"].includes(hlRevealCard.suit) ? "text-red-500" : "text-slate-300"}`}>
                        {hlRevealCard.suit}
                      </Text>
                    </View>
                  </>
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Ionicons name="help-circle-outline" size={40} color="rgba(255,255,255,0.15)" />
                  </View>
                )}
              </View>
            </View>

            {/* Guesses and feedback */}
            <View className="w-full px-5 items-center">
              {hlStatus === "playing" && (
                <View className="w-full">
                  <View className="flex-row space-x-3 mb-3">
                    <TouchableOpacity
                      onPress={() => playHigherLower("higher")}
                      className="flex-1 bg-orange-400 py-3.5 rounded-2xl items-center active:scale-95 shadow-md shadow-orange-500/10"
                    >
                      <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">HÖHER ⬆️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => playHigherLower("lower")}
                      className="flex-1 bg-slate-900 border border-white/5 py-3.5 rounded-2xl items-center active:scale-95"
                    >
                      <Text className="text-white font-black text-xs uppercase tracking-wider">TIEFER ⬇️</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    onPress={passHigherLower}
                    disabled={hlScore === 0}
                    className={`w-full py-3.5 rounded-2xl items-center border active:scale-95 ${
                      hlScore === 0 ? "border-slate-800 opacity-30" : "border-emerald-500/40 bg-emerald-500/10"
                    }`}
                  >
                    <Text
                      className={`font-black text-xs uppercase tracking-wider ${
                        hlScore === 0 ? "text-slate-500" : "text-emerald-400"
                      }`}
                    >
                      Nächster Spieler ist dran 🤝
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {hlStatus === "correct" && (
                <View className="w-full items-center">
                  <Text className="text-emerald-400 text-xs font-black uppercase mb-3">Richtig geraten! 🎉</Text>
                  <TouchableOpacity
                    onPress={nextHigherLowerRound}
                    className="w-full bg-orange-400 py-3.5 rounded-2xl items-center active:scale-95"
                  >
                    <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Nächste Karte ➡️</Text>
                  </TouchableOpacity>
                </View>
              )}

              {hlStatus === "gameover" && (
                <View className="w-full items-center">
                  <Text className="text-rose-500 text-xs font-black uppercase mb-3">
                    Falsch geraten! Straf-Schluck fällig! 💀
                  </Text>
                  <TouchableOpacity
                    onPress={handleHlWrongModalDismiss}
                    className="w-full bg-rose-500 py-3.5 rounded-2xl items-center active:scale-95 shadow"
                  >
                    <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">
                      Weiter spielen 🍻
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {hlStatus === "passed" && (
                <View className="w-full items-center">
                  <Text className="text-emerald-400 text-xs font-black uppercase mb-3 text-center px-4">
                    Nächster Spieler ist dran! Du gibst das Spiel sicher weiter.
                  </Text>
                  <TouchableOpacity
                    onPress={startHigherLower}
                    className="w-full bg-slate-900 border border-white/5 py-3.5 rounded-2xl items-center active:scale-95"
                  >
                    <Text className="text-white font-black text-xs uppercase tracking-wider">
                      Neue Runde starten
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* RED GLOWING MODAL (Wrong guess in Higher/Lower) */}
      <Modal visible={showHlWrongModal} transparent={true} animationType="fade">
        <View className="flex-1 bg-black/90 justify-center items-center px-6">
          <View className="bg-slate-900 border-2 border-rose-500/60 w-full max-w-[300px] rounded-3xl p-6 items-center shadow-2xl shadow-rose-500/10">
            <Ionicons name="alert-circle" size={56} color="#f43f5e" className="mb-4" />
            <Text className="text-rose-500 text-lg font-black uppercase tracking-wider text-center mb-2">
              Falsch geraten!
            </Text>
            <Text className="text-white text-xs font-black text-center mb-6 px-2">Du musst trinken! 🍻</Text>
            <TouchableOpacity
              onPress={handleHlWrongModalDismiss}
              className="w-full bg-rose-500 py-3.5 rounded-2xl items-center justify-center active:scale-95 shadow"
            >
              <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Schließen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* C. SKULL CARD GAME OVERLAY */}
      <Modal visible={activeFullscreenGame === "cards"} animationType="slide" transparent={false}>
        <View className="flex-1 bg-slate-950 pt-14 px-5">
          {renderCancelConfirmOverlay()}
          <View className="flex-row items-center justify-between mb-6">
            <TouchableOpacity onPress={() => setShowCancelConfirm(true)} className="flex-row items-center space-x-1 p-1">
              <Ionicons name="close-circle-outline" size={20} color="#34d399" />
              <Text className="text-emerald-400 text-xs font-black uppercase ml-1">Spiel abbrechen</Text>
            </TouchableOpacity>
            <Text className="text-white text-sm font-black uppercase tracking-wider">Skull Kartenspiel</Text>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                setActiveFullscreenGame(null);
                setLobbyGameSelected(null);
              }}
              className="flex-row items-center space-x-1 p-1"
            >
              <Ionicons name="home-outline" size={18} color="#64748b" />
              <Text className="text-slate-500 text-[10px] font-black uppercase ml-1">Minimieren</Text>
            </TouchableOpacity>
          </View>

          {/* Mode Switcher */}
          <View className="flex-row bg-slate-900 border border-white/5 rounded-2xl p-1 mb-6">
            {[
              { key: "normal", label: "Normal 🍻", color: "text-emerald-400" },
              { key: "hardcore", label: "Hardcore 🔥", color: "text-red-400" },
              { key: "spicy", label: "18+ Spicy 🔞", color: "text-pink-400" },
            ].map((m) => (
              <TouchableOpacity
                key={m.key}
                onPress={() => {
                  triggerHaptic("light");
                  setSkullMode(m.key as "normal" | "hardcore" | "spicy");
                  setSkullStatus("setup");
                }}
                className={`flex-1 py-2 items-center rounded-xl ${
                  skullMode === m.key ? "bg-white/5 border border-white/10" : ""
                }`}
              >
                <Text className={`text-[9px] font-black uppercase tracking-wider ${m.color}`}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {skullStatus === "setup" ? (
            <View className="flex-1 items-center justify-center pb-20">
              <Ionicons name="albums-outline" size={80} color="#34d399" className="mb-4" />
              <Text className="text-white text-base font-black uppercase mb-2">Skull (King&apos;s Cup) 💀</Text>
              <Text className="text-slate-500 text-xs text-center px-8 mb-6 leading-relaxed">
                Jede gezogene Karte hat eine spezielle Aufgabe. Konfiguriere deinen Modus oben und klicke zum Mischen
                und Starten des Decks!
              </Text>
              <TouchableOpacity
                onPress={startSkullGame}
                className="bg-emerald-500 py-4 px-10 rounded-3xl active:scale-95 shadow-lg shadow-emerald-500/10"
              >
                <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Mischen & Starten 🔄</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-1 items-center justify-between pb-10">
              {/* Card layout */}
              <TouchableOpacity
                onPress={drawSkullCard}
                className={`w-64 aspect-[5/7] bg-slate-900 rounded-3xl p-5 justify-between border-2 shadow-2xl items-center relative ${
                  skullMode === "hardcore"
                    ? "border-red-500/40 shadow-red-500/5"
                    : skullMode === "spicy"
                    ? "border-pink-500/40 shadow-pink-500/5"
                    : "border-emerald-500/40 shadow-emerald-500/5"
                }`}
              >
                {currentSkullCard ? (
                  <>
                    <View className="absolute top-4 left-5 flex-row items-center">
                      <Text
                        className={`text-xl font-black ${
                          ["♥", "♦"].includes(currentSkullCard.suit) ? "text-red-500" : "text-white"
                        }`}
                      >
                        {currentSkullCard.label}
                      </Text>
                      <Text
                        className={`text-base ml-0.5 ${
                          ["♥", "♦"].includes(currentSkullCard.suit) ? "text-red-500" : "text-slate-400"
                        }`}
                      >
                        {currentSkullCard.suit}
                      </Text>
                    </View>
                    <View className="items-center justify-center flex-1 mt-6">
                      <Text
                        className={`text-lg font-black uppercase text-center ${
                          skullMode === "hardcore"
                            ? "text-red-400"
                            : skullMode === "spicy"
                            ? "text-pink-400"
                            : "text-emerald-400"
                        }`}
                      >
                        {getSkullRule(currentSkullCard).name}
                      </Text>
                      <Text className="text-white text-[10px] font-bold text-center mt-2 px-1 leading-normal">
                        {getSkullRule(currentSkullCard).desc}
                      </Text>
                    </View>
                    <View className="w-full border-t border-white/5 pt-2 items-center">
                      <Text className="text-[8px] font-black text-amber-500 tracking-wider uppercase">
                        Trink-Regel Aktiv! 🍻
                      </Text>
                    </View>
                  </>
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Ionicons
                      name="beer"
                      size={56}
                      color={skullMode === "hardcore" ? "#f87171" : skullMode === "spicy" ? "#f472b6" : "#34d399"}
                      className="mb-2"
                    />
                    <Text className="text-white text-xs font-black uppercase tracking-wider text-center">
                      Tippe zum Ziehen!
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Deck Info & Action keys */}
              <View className="w-full px-5 items-center mt-6">
                <Text className="text-slate-500 text-[9px] font-extrabold uppercase tracking-widest mb-3">
                  Karten übrig: {skullDeck.length} / 52
                </Text>

                <View className="flex-row space-x-3 w-full">
                  <TouchableOpacity
                    onPress={startSkullGame}
                    className="flex-1 bg-slate-900 border border-white/5 py-3.5 rounded-2xl items-center"
                  >
                    <Text className="text-slate-400 font-black text-xs">Mischen 🔄</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={drawSkullCard}
                    className="flex-1 bg-emerald-500 py-3.5 rounded-2xl items-center active:scale-95"
                  >
                    <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Ziehen ➡️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* D. TRUTH OR DARE OVERLAY */}
      <Modal visible={activeFullscreenGame === "truth"} animationType="slide" transparent={false}>
        <View className="flex-1 bg-slate-950 pt-14 px-5">
          {renderCancelConfirmOverlay()}
          <View className="flex-row items-center justify-between mb-6">
            <TouchableOpacity onPress={() => setShowCancelConfirm(true)} className="flex-row items-center space-x-1 p-1">
              <Ionicons name="close-circle-outline" size={20} color="#a855f7" />
              <Text className="text-purple-400 text-xs font-black uppercase ml-1">Spiel abbrechen</Text>
            </TouchableOpacity>
            <Text className="text-white text-sm font-black uppercase tracking-wider">Wahrheit oder Pflicht</Text>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                setActiveFullscreenGame(null);
                setLobbyGameSelected(null);
              }}
              className="flex-row items-center space-x-1 p-1"
            >
              <Ionicons name="home-outline" size={18} color="#64748b" />
              <Text className="text-slate-500 text-[10px] font-black uppercase ml-1">Minimieren</Text>
            </TouchableOpacity>
          </View>

          {/* Active Game */}
          <View className="flex-1 items-center justify-between pb-10">
            {/* Spinner wheel representation */}
            <View className="w-60 h-60 rounded-full border border-purple-500/10 bg-slate-900/30 items-center justify-center relative my-4">
              <RNAnimated.View
                style={{ transform: [{ rotate: spinAngle }] }}
                className="w-12 h-36 items-center justify-center z-20"
              >
                <View className="w-3.5 h-14 bg-purple-500 rounded-t-full shadow-lg shadow-purple-500/50" />
                <View className="w-7 h-7 rounded-full bg-slate-950 border border-purple-400 -my-2.5" />
                <View className="w-3.5 h-14 bg-slate-800 rounded-b-full" />
              </RNAnimated.View>

              {/* Layout players dynamically in a circle */}
              <View className="absolute inset-0 items-center justify-center">
                {players.map((player, idx) => {
                  const total = players.length;
                  const angle = (idx * 2 * Math.PI) / total - Math.PI / 2;
                  const radius = 95;
                  const x = radius * Math.cos(angle);
                  const y = radius * Math.sin(angle);
                  const isSelected = selectedPlayer?.id === player.id;

                  return (
                    <View
                      key={player.id}
                      style={{
                        position: "absolute",
                        transform: [{ translateX: x }, { translateY: y }],
                      }}
                      className="items-center justify-center"
                    >
                      <RNAnimated.View
                        style={
                          isSelected
                            ? {
                                borderColor: "#a855f7",
                                borderWidth: 2,
                                borderRadius: 9999,
                                shadowColor: "#a855f7",
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: 0.8,
                                shadowRadius: 10,
                                transform: [{ scale: pulseScale }],
                              }
                            : {
                                borderColor: "rgba(255,255,255,0.05)",
                                borderWidth: 1,
                                borderRadius: 9999,
                              }
                        }
                        className="bg-slate-900/95 px-3 py-1.5 rounded-full"
                      >
                        <Text
                          className={`text-[10px] font-black text-center ${
                            isSelected ? "text-purple-400 font-extrabold" : "text-white/60"
                          }`}
                          numberOfLines={1}
                        >
                          {player.name}
                        </Text>
                      </RNAnimated.View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Spinner trigger */}
            <TouchableOpacity
              onPress={spinBottle}
              disabled={isSpinning}
              className="bg-purple-500 py-3.5 px-8 rounded-2xl shadow active:scale-95 disabled:opacity-40"
            >
              <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Flasche drehen 🌀</Text>
            </TouchableOpacity>

            {/* Task display card */}
            {selectedPlayer && (
              <View className="bg-slate-900 border border-purple-500/20 p-5 rounded-3xl w-full items-center my-4 shadow-xl">
                <Text className="text-slate-500 text-[8px] font-black uppercase">Ausgewählter Spieler</Text>
                <Text className="text-purple-400 text-base font-black mt-0.5 mb-3">{selectedPlayer.name} 👉</Text>

                {todType === null ? (
                  <View className="flex-row space-x-3 w-full">
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic("light");
                        setTodType("truth");
                      }}
                      className="flex-1 bg-cyan-500/10 border border-cyan-400/35 py-2.5 rounded-xl items-center"
                    >
                      <Text className="text-cyan-400 font-black text-[10px] uppercase">Wahrheit 🤔</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic("light");
                        setTodType("dare");
                      }}
                      className="flex-1 bg-fuchsia-500/10 border border-fuchsia-400/35 py-2.5 rounded-xl items-center"
                    >
                      <Text className="text-fuchsia-400 font-black text-[10px] uppercase">Pflicht 😈</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="w-full items-center">
                    <Text className="text-slate-500 text-[8px] font-black uppercase mb-1">
                      {todType === "truth" ? "Die Frage:" : "Die Pflichtaufgabe:"}
                    </Text>
                    <Text className="text-white text-xs font-bold text-center leading-relaxed mb-5">
                      {todType === "truth" ? TRUTHS[todIndex] : DARES[todIndex]}
                    </Text>

                    <View className="flex-row space-x-3 w-full">
                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic("success");
                          setSelectedPlayer(null);
                          setTodType(null);
                        }}
                        className="flex-1 bg-slate-950 border border-white/5 py-3 rounded-xl items-center"
                      >
                        <Text className="text-slate-400 font-bold text-xs">Erledigt</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic("medium");
                          Alert.alert("Gekniffen!", `${selectedPlayer.name} kneift und muss trinken! 🍻`);
                          setSelectedPlayer(null);
                          setTodType(null);
                        }}
                        className="flex-1 bg-purple-500 py-3 rounded-xl items-center shadow active:scale-95"
                      >
                        <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">
                          Gekniffen 🍻
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            )}

            <View className="h-6" />
          </View>
        </View>
      </Modal>

      {/* ==========================================
          MODAL: DUELS CHALLENGE SELECTOR FORM
          ========================================== */}
      <Modal
        visible={showCreateDuel}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCreateDuel(false)}
      >
        <View className="flex-1 bg-black/85 justify-center items-center px-6">
          <View className="bg-slate-900 border border-white/10 w-full max-w-[320px] rounded-3xl p-5 shadow-2xl">
            <Text className="text-white text-sm font-black uppercase tracking-wider mb-4 text-center">
              Duell starten ⚔️
            </Text>

            <Text className="text-slate-500 text-[8px] font-black uppercase mb-1.5">Gegner auswählen</Text>
            <ScrollView className="max-h-[160px] mb-4">
              {users.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  onPress={() => setSelectedOpponentId(u.id)}
                  className={`p-3 rounded-xl mb-2 flex-row justify-between items-center ${
                    selectedOpponentId === u.id ? "bg-cyan-400/10 border border-cyan-400/30" : "bg-slate-950/40"
                  }`}
                >
                  <View className="flex-1 mr-2">
                    <Text className="text-white text-xs font-bold">{u.name}</Text>
                    <Text className="text-cyan-400 text-[8px] font-medium mt-0.5">
                      Lv. {u.currentLevel || u.level || 1} - {u.title || "Neuling"}
                    </Text>
                  </View>
                  {selectedOpponentId === u.id && <Ionicons name="checkmark" size={14} color="#22d3ee" />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text className="text-slate-500 text-[8px] font-black uppercase mb-1.5">Duell-Dauer (Minuten)</Text>
            <View className="flex-row space-x-2 mb-6">
              {["30", "60", "120", "240"].map((mins) => {
                const isActive = duelDuration === mins;
                return (
                  <TouchableOpacity
                    key={mins}
                    onPress={() => setDuelDuration(mins)}
                    className={`flex-1 py-2 rounded-xl border items-center ${
                      isActive ? "bg-cyan-400/15 border-cyan-400" : "bg-slate-950/60 border-white/5"
                    }`}
                  >
                    <Text className={`text-[10px] font-bold ${isActive ? "text-cyan-400" : "text-slate-400"}`}>
                      {mins} Min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View className="flex-row space-x-3">
              <TouchableOpacity
                onPress={() => setShowCreateDuel(false)}
                className="flex-1 bg-slate-950 border border-white/5 py-3 rounded-2xl items-center"
              >
                <Text className="text-slate-400 font-black text-xs">Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateDuel} className="flex-1 bg-cyan-400 py-3 rounded-2xl items-center shadow">
                <Text className="text-slate-950 font-black text-xs">Senden</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {renderCancelConfirmOverlay()}
    </View>
  );
}
