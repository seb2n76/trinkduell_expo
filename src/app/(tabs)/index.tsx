import React, { useState, useCallback, useMemo } from "react";
import {
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { User, Drink, DrinkLog, Duel, GroupQuest, calculateAlcoholGrams, getCumulativeXpForLevel } from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import { FloatingPointItem, FloatingPointItemType } from "@/components/FloatingPoints";
import { AchievementModal } from "@/components/AchievementModal";
import { useAuth } from "../_layout";
import {
  getCoordinatesForDrinkLog,
  getCurrentCoordinates,
  getLocationMode,
  DEFAULT_LOCATION_MODE,
  type LocationMode,
  type Coordinates,
} from "@/services/location";
// Lazy on purpose: the camera module is only needed once someone taps
// "Scannen", and it has no business in the bundle everyone loads first.
const BarcodeScanner = React.lazy(() => import("@/components/BarcodeScanner"));

/** Kartenhintergrund. Etwas heller als der Seitenhintergrund (slate-950),
  * damit Karten ohne kräftigen Rahmen auskommen. */
/** Seitenhintergrund: tiefes Navy statt reinem Schwarz. */
const PAGE_BG = "#0B111E";

const CARD_BG = "#161F30";

/**
 * Vier Reiter statt sechs Kategorien.
 *
 * Der Datentyp kennt sechs (`Drink["category"]`), die Oberfläche zeigt vier —
 * Sekt geht zu den Weinen, Schnaps zu den Mischgetränken. Sonst hätte man
 * zwei Reiter mit je zwei Einträgen, und genau diese Zersplitterung war der
 * Grund, die Kategorie-Reiter beim letzten Umbau ganz zu streichen.
 */
const CATEGORY_TABS = [
  { key: "bier", label: "Biere", plural: "Biere", icon: "🍺", accent: "#F59E0B", matches: ["Bier"] },
  { key: "wein", label: "Weine", plural: "Weine und Sekt", icon: "🍷", accent: "#E11D48", matches: ["Wein", "Sekt"] },
  { key: "mix", label: "Cocktails", plural: "Cocktails und Shots", icon: "🍹", accent: "#06B6D4", matches: ["Mischgetränk", "Schnaps"] },
  { key: "frei", label: "Alkoholfrei", plural: "alkoholfreien Getränke", icon: "💧", accent: "#10B981", matches: ["Alkoholfrei"] },
] as const;

type CategoryKey = (typeof CATEGORY_TABS)[number]["key"];

/** Wie viele Karten ein Reiter zeigt, bevor auf die Suche verwiesen wird. */
const CARDS_PER_CATEGORY = 3;

/** Slots in der persönlichen Schnellwahl. */
const QUICK_PICK_SLOTS = 3;

const accentForCategory = (category: string) =>
  CATEGORY_TABS.find((t) => (t.matches as readonly string[]).includes(category))?.accent ?? "#94a3b8";

/**
 * Standard-Portionsgrößen pro Kategorie für das Schnellwahl-Options-Sheet.
 */
const getVolumePresets = (category: Drink["category"], defaultVolume: number) => {
  const presets: { label: string; volume: number }[] = [];
  if (category === "Bier") {
    presets.push(
      { label: "0,33 l", volume: 330 },
      { label: "0,5 l", volume: 500 },
      { label: "1,0 l (Maß)", volume: 1000 },
      { label: "Schluck", volume: 30 }
    );
  } else if (category === "Wein" || category === "Sekt") {
    presets.push(
      { label: "0,1 l", volume: 100 },
      { label: "0,2 l", volume: 200 },
      { label: "0,25 l", volume: 250 },
      { label: "Schluck", volume: 20 }
    );
  } else if (category === "Schnaps") {
    presets.push(
      { label: "2 cl (Shot)", volume: 20 },
      { label: "4 cl (Doppelt)", volume: 40 },
      { label: "1 cl (Mini)", volume: 10 }
    );
  } else if (category === "Mischgetränk") {
    presets.push(
      { label: "0,2 l", volume: 200 },
      { label: "0,3 l", volume: 300 },
      { label: "0,5 l", volume: 500 },
      { label: "Schluck", volume: 30 }
    );
  } else {
    presets.push(
      { label: "0,25 l (Glas)", volume: 250 },
      { label: "0,33 l (Dose/Flasche)", volume: 330 },
      { label: "0,5 l (Groß)", volume: 500 },
      { label: "Schluck", volume: 30 }
    );
  }

  if (!presets.some((p) => p.volume === defaultVolume)) {
    presets.unshift({ label: `${(defaultVolume / 1000).toFixed(2)} l`, volume: defaultVolume });
  }
  return presets;
};

/**
 * Format remaining time until quest or duel end.
 */
const formatRemainingTime = (endTimeStr: string | null): string => {
  if (!endTimeStr) return "";
  const end = new Date(endTimeStr).getTime();
  const now = Date.now();
  const diffMs = end - now;
  if (diffMs <= 0) return "Beendet";
  const diffMin = Math.floor(diffMs / (60 * 1000));
  if (diffMin < 60) return `noch ${diffMin} Min.`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    const remMin = diffMin % 60;
    return remMin > 0 ? `noch ${diffHours} Std. ${remMin}m` : `noch ${diffHours} Std.`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `noch ${diffDays} Tg.`;
};

interface UndoState {
  logIds: string[];
  drinkName: string;
  pointsEarned: number;
  expiresAt: number;
}

const getRankBadgeStyles = (rank: User["rank"]) => {
  switch (rank) {
    case "Diamant":
      return { bg: "bg-cyan-400/10 border-cyan-400/20", color: "#22d3ee", label: "Diamant" };
    case "Platin":
      return { bg: "bg-fuchsia-500/10 border-fuchsia-500/20", color: "#d946ef", label: "Platin" };
    case "Gold":
      return { bg: "bg-yellow-400/10 border-yellow-400/20", color: "#eab308", label: "Gold" };
    case "Silber":
      return { bg: "bg-slate-300/10 border-slate-300/20", color: "#cbd5e1", label: "Silber" };
    case "Bronze":
      return { bg: "bg-amber-600/10 border-amber-600/20", color: "#d97706", label: "Bronze" };
    default:
      return { bg: "bg-slate-500/10 border-slate-500/20", color: "#94a3b8", label: "Unranked" };
  }
};

export default function DashboardScreen() {
  const router = useRouter();
  const { user: authUser, updateUserContext } = useAuth();
  const user = authUser;

  // useWindowDimensions statt Dimensions.get(): letzteres liest genau einmal
  // beim Laden des Moduls. Im Browser bliebe das Layout danach auf der
  // Startbreite stehen, auch wenn das Fenster gezogen wird.
  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth >= 1024;

  // GPS/Location deactivated for cross-platform stability (no expo-location)

  // Der geteilte Katalog (alles, was dieser Nutzer sehen darf).
  const [drinks, setDrinks] = useState<Drink[]>([]);
  // Die persönliche Schnellwahl: nur diese erscheinen als Kachel.
  const [myDrinks, setMyDrinks] = useState<Drink[]>([]);
  const [logs, setLogs] = useState<DrinkLog[]>([]);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Duelle & Quests
  const [duels, setDuels] = useState<Duel[]>([]);
  const [groupQuests, setGroupQuests] = useState<GroupQuest[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Undo-Leiste (5 Sekunden nach dem Loggen aktiv)
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const undoTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Options-Sheet für Long-Press auf Favoriten
  const [portionOptionsDrink, setPortionOptionsDrink] = useState<Drink | null>(null);
  const [selectedPortionVolume, setSelectedPortionVolume] = useState<number>(500);
  const [selectedPortionCount, setSelectedPortionCount] = useState<number>(1);

  // Auswahl-Ansicht und Bearbeiten-Modus der Schnellwahl
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [drinkSearch, setDrinkSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [savingPicks, setSavingPicks] = useState(false);
  // Gerade gescanntes Getränk, das noch nicht in der Schnellwahl ist — wird
  // als Angebot eingeblendet statt ungefragt hinzugefügt.
  const [pendingQuickPick, setPendingQuickPick] = useState<Drink | null>(null);
  // Aktiver Kategorie-Reiter unter der Schnellwahl.
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("bier");
  // Auf welche Kategorie die Auswahl-Ansicht beim öffnen eingeschränkt ist.
  // null = ganzer Katalog (so kommt man über einen leeren Favoriten-Slot rein),
  // gesetzt beim Weg über "Alle ... anzeigen".
  const [pickerCategory, setPickerCategory] = useState<CategoryKey | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  // Set while the "custom drink" dialog is finishing a scan of an unknown
  // barcode, so the new drink is saved with that code attached.
  const [pendingEan, setPendingEan] = useState<string | null>(null);

  // Achievements & Points Animations
  const [floatingPoints, setFloatingPoints] = useState<FloatingPointItemType[]>([]);
  const [activeAchievementId, setActiveAchievementId] = useState<string | null>(null);

  // Form State for Custom Drink Creator
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<Drink["category"]>("Bier");
  const [formVolume, setFormVolume] = useState("");
  const [formAbv, setFormAbv] = useState("");
  const [isLevelingUp, setIsLevelingUp] = useState(false);

  // Custom drink validation checks
  const formVolNum = parseInt(formVolume, 10);
  const formAbvNum = parseFloat(formAbv.replace(",", "."));
  const isValuesTooHigh = (!isNaN(formVolNum) && formVolNum > 3000) || (!isNaN(formAbvNum) && formAbvNum > 80);

  // Alert.alert is a no-op on react-native-web — without this, errors and
  // confirmations were completely invisible in the browser.
  const notify = (title: string, message: string) => {
    if (Platform.OS === "web") {
      window.alert(message);
      return;
    }
    Alert.alert(title, message);
  };

  // Aktive Duelle (aktiv oder offene Herausforderungen an mich)
  const relevantDuels = useMemo(() => {
    if (!user) return [];
    return duels.filter(
      (d) =>
        d.status === "active" ||
        (d.status === "pending" && d.opponentId === user.id)
    );
  }, [duels, user]);

  // Aktive Gruppen-Quests
  const activeQuests = useMemo(() => {
    return groupQuests.filter((q) => q.status === "active");
  }, [groupQuests]);

  const hasActiveChallenges = relevantDuels.length > 0 || activeQuests.length > 0;

  const handleLevelUp = async () => {
    setIsLevelingUp(true);
    try {
      await triggerHaptic("success");
      const updatedUser = await apiService.levelUp();
      updateUserContext(updatedUser);
      setSuccessBanner(`Glückwunsch! Du bist jetzt Level ${updatedUser.level}! 🎉`);
      setTimeout(() => setSuccessBanner(null), 4000);
      await loadData();
    } catch (error) {
      await triggerHaptic("error");
      console.error("Failed to level up user:", error);
      notify("Fehler", "Level-Up konnte nicht bestätigt werden.");
    } finally {
      setIsLevelingUp(false);
    }
  };

  const loadData = async () => {
    try {
      const [currentUser, drinkList, myList, allLogs, duelsList, questsList, usersList] = await Promise.all([
        apiService.getCurrentUser(),
        apiService.getDrinks().catch(() => []),
        apiService.getMyDrinks().catch(() => []),
        apiService.getDrinkLogs().catch(() => []),
        apiService.getDuels().catch(() => []),
        apiService.getGroupQuests().catch(() => []),
        apiService.getUsers().catch(() => []),
      ]);

      updateUserContext(currentUser);
      setDrinks(drinkList);
      setMyDrinks(myList);
      setDuels(duelsList);
      setGroupQuests(questsList);
      setAllUsers(usersList);

      const userLogs = allLogs.filter((l) => l.userId === currentUser.id);
      const sortedLogs = userLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setLogs(sortedLogs);

      // Der Modus steuert, ob unten der Check-in-Streifen erscheint.
      setLocationMode(await getLocationMode());
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  // Getränkedetails aus dem geladenen Katalog. Hier stand bis 17.08.2026
  // eine fest verdrahtete Kopie des Katalogs — die zweite von zweien in
  // dieser Datei. Beide sind in server/db.js zusammengeführt, damit es genau
  // eine Wahrheit darüber gibt, welche Getränke existieren.
  const getDrinkDetails = (drinkId: string) => {
    const match = drinks.find(d => d.id === drinkId);
    if (match) {
      return {
        name: match.name,
        volume: match.volume,
        abv: match.abv,
      };
    }
    return { name: "Getränk", volume: 330, abv: 4.9 };
  };

  // Helper: check if Kater-Schutz is active (logged water in the last 30 minutes)
  const getKaterSchutzStatus = (): { active: boolean; minutesLeft?: number; drinkName?: string } => {
    if (logs.length === 0 || drinks.length === 0) return { active: false };

    // Find the latest water log
    const latestWaterLog = logs.find((log) => {
      const drinkDetails = getDrinkDetails(log.drinkId);
      return drinkDetails.abv === 0;
    });

    if (latestWaterLog) {
      const drinkDetails = getDrinkDetails(latestWaterLog.drinkId);
      const logTime = new Date(latestWaterLog.timestamp).getTime();
      const diffMs = Date.now() - logTime;
      const limitMs = 30 * 60 * 1000;

      if (diffMs < limitMs) {
        const minLeft = Math.ceil((limitMs - diffMs) / 60000);
        return { active: true, minutesLeft: minLeft, drinkName: drinkDetails.name };
      }
    }
    return { active: false };
  };

  const katerSchutz = getKaterSchutzStatus();

  /**
   * Der Katalog für die Auswahl-Ansicht.
   *
   * Zwei Filter, in dieser Reihenfolge: ein Suchbegriff schlägt den
   * Kategorie-Vorfilter. Wer tippt, sucht im ganzen Katalog — sonst fände man
   * ein Bier nicht, nur weil die Ansicht über den Wein-Reiter geöffnet wurde.
   */
  const catalogSearchResults = useMemo(() => {
    const query = drinkSearch.trim().toLowerCase();
    // Ausgeblendete raus: sie bleiben im Katalog, damit alte Log-Eintraege
    // weiter aufloesen, sollen aber nicht mehr waehlbar sein.
    const waehlbar = drinks.filter((d) => !d.hidden);
    const tab = pickerCategory ? CATEGORY_TABS.find((t) => t.key === pickerCategory) : null;
    const matches = tab ? (tab.matches as readonly string[]) : null;

    // Der Vorfilter gilt nur, solange nicht gesucht wird: wer tippt, sucht im
    // ganzen Katalog — sonst findet man ein Bier nicht, weil gerade der
    // Wein-Reiter offen war.
    const list = query
      ? waehlbar.filter((d) => d.name.toLowerCase().includes(query))
      : matches
      ? waehlbar.filter((d) => matches.includes(d.category))
      : waehlbar;

    // Alphabetisch innerhalb der Kategorie, damit die Liste vorhersehbar ist.
    return [...list].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    );
  }, [drinks, drinkSearch, pickerCategory]);

  /** Wie oft dieser Nutzer welches Getränk geloggt hat. */
  const logCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of logs) counts.set(log.drinkId, (counts.get(log.drinkId) || 0) + 1);
    return counts;
  }, [logs]);

  /**
   * Die drei Karten des aktiven Reiters — nach eigener Trinkhistorie sortiert,
   * bei Gleichstand alphabetisch.
   *
   * Ohne Historie ist das schlicht der Katalog von oben; sobald jemand die App
   * benutzt, stehen dort seine tatsächlichen Getränke. Das ist der Unterschied
   * zwischen drei beliebigen und drei brauchbaren Karten.
   */
  const categoryCards = useMemo(() => {
    const tab = CATEGORY_TABS.find((t) => t.key === activeCategory);
    if (!tab) return [];
    const matches = tab.matches as readonly string[];
    return drinks.filter((d) => !d.hidden)
      .filter((d) => matches.includes(d.category))
      .sort(
        (a, b) =>
          (logCounts.get(b.id) || 0) - (logCounts.get(a.id) || 0) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, CARDS_PER_CATEGORY);
  }, [drinks, activeCategory, logCounts]);

  /** Wie viele Getränke der aktive Reiter insgesamt hätte. */
  const categoryTotal = useMemo(() => {
    const tab = CATEGORY_TABS.find((t) => t.key === activeCategory);
    if (!tab) return 0;
    const matches = tab.matches as readonly string[];
    return drinks.filter((d) => !d.hidden).filter((d) => matches.includes(d.category)).length;
  }, [drinks, activeCategory]);

  const activeCategoryLabel =
    CATEGORY_TABS.find((t) => t.key === activeCategory)?.plural ?? "Getränke";

  // Extract exactly last 3 logs
  const lastThreeLogs = useMemo(() => {
    return logs.slice(0, 3);
  }, [logs]);

  // ── Check-in ────────────────────────────────────────────────────────────
  //
  // Der Standort-Modus „Nur bei Check-in" gab es seit jeher, aber ohne
  // Auslöser: `getCoordinatesForDrinkLog()` liefert in diesem Modus immer
  // null, die Einstellung verhielt sich also wie „Aus" und versprach etwas,
  // das nicht passierte.
  //
  // Ein Check-in merkt sich den Ort EINMAL und hängt ihn an das nächste
  // geloggte Getränk. Bewusst nicht dauerhaft gespeichert: nach einem Neustart
  // der App ist er weg, und das ist bei Standortdaten die richtige
  // Voreinstellung.
  const [locationMode, setLocationMode] = useState<LocationMode>(DEFAULT_LOCATION_MODE);
  const [checkIn, setCheckIn] = useState<{ coords: Coordinates; at: number } | null>(null);
  const [checkInBusy, setCheckInBusy] = useState(false);

  // Ein Ort von vor Stunden ist kein Ort mehr, an dem man ist.
  const CHECKIN_GUELTIG_MS = 4 * 60 * 60 * 1000;
  const checkInAktiv =
    checkIn !== null && Date.now() - checkIn.at < CHECKIN_GUELTIG_MS;

  const handleCheckIn = async () => {
    setCheckInBusy(true);
    try {
      const coords = await getCurrentCoordinates();
      if (!coords) {
        await triggerHaptic("error");
        notify(
          "Kein Standort",
          "Der Ort konnte nicht bestimmt werden. Prüfe die Standort-Freigabe deines Geräts — im Browser braucht es außerdem eine HTTPS-Verbindung."
        );
        return;
      }
      await triggerHaptic("success");
      setCheckIn({ coords, at: Date.now() });
    } finally {
      setCheckInBusy(false);
    }
  };

  const handleLogDrink = async (
    item: { id: string; name: string; volume: number; abv: number; category: Drink["category"] },
    pageX?: number,
    pageY?: number,
    options?: { count?: number; customVolume?: number }
  ) => {
    const count = Math.max(1, Math.min(10, options?.count || 1));
    const volume = options?.customVolume || item.volume;
    const isWater = item.abv === 0;
    const grams = calculateAlcoholGrams(volume, item.abv);

    // Zwei Wege zum Ort, in dieser Reihenfolge:
    //   1. ein aktiver Check-in — der Nutzer hat ausdrücklich gesagt "hier bin ich"
    //   2. der Automatik-Modus, der bei "manual"/"off" null liefert
    // Beides scheitert leise: ein Getränk zu loggen darf nie am GPS hängen.
    const coords = checkInAktiv && checkIn ? checkIn.coords : await getCoordinatesForDrinkLog();
    // Ein Check-in gilt fuer genau ein Getraenk. Sonst wuerde er unbemerkt
    // an jedem weiteren haengen bleiben, auch Stunden spaeter woanders.
    if (checkInAktiv) setCheckIn(null);
    const latitude: number | null = coords ? coords.latitude : null;
    const longitude: number | null = coords ? coords.longitude : null;

    let resolvedDrinkId = item.id;

    try {
      // Ensure the drink exists or resolve variation
      const foundDrink =
        drinks.find((d) => d.id === item.id && d.volume === volume) ||
        drinks.find((d) => d.name.toLowerCase() === item.name.toLowerCase() && d.volume === volume && d.abv === item.abv);

      if (foundDrink) {
        resolvedDrinkId = foundDrink.id;
      } else if (volume !== item.volume || !drinks.some((d) => d.id === item.id)) {
        try {
          const created = await apiService.createDrink({
            name: volume !== item.volume ? `${item.name} ${(volume / 1000).toFixed(2)}l` : item.name,
            category: item.category,
            volume: volume,
            abv: item.abv,
            calories: isWater ? 0 : Math.round(volume * 0.43),
          });
          resolvedDrinkId = created.id;
        } catch (dbErr) {
          console.warn("Could not seed drink database, using default logging format:", dbErr);
        }
      }

      let singlePoints = isWater ? 10 : 10 + Math.round(grams * 2);
      if (!isWater && katerSchutz.active) {
        singlePoints = Math.round(singlePoints * 1.25);
      }
      const totalPointsEarned = singlePoints * count;

      // Optimistic XP bar update on success trigger
      if (user) {
        updateUserContext({
          ...user,
          points: user.points + totalPointsEarned,
        });
      }

      // Log the drink(s) using apiService (manages both server POST and offline queue automatically)
      const createdLogs: DrinkLog[] = [];
      for (let i = 0; i < count; i++) {
        const logged = await apiService.addDrinkLog(resolvedDrinkId, undefined, latitude, longitude);
        if (logged && logged.id) {
          createdLogs.push(logged);
        }
      }

      await triggerHaptic("medium");

      const xCoord = pageX || screenWidth / 2;
      const yCoord = pageY || 300;

      setFloatingPoints((prev) => [
        ...prev,
        { id: `float-${Date.now()}-${Math.random()}`, x: xCoord, y: yCoord, text: `+${totalPointsEarned} XP` },
      ]);

      // Set Undo state for 5 seconds
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
      const logIds = createdLogs.map((l) => l.id);
      const displayDrinkName = count > 1 ? `${count}x ${item.name}` : item.name;
      setUndoState({
        logIds,
        drinkName: displayDrinkName,
        pointsEarned: totalPointsEarned,
        expiresAt: Date.now() + 5000,
      });

      undoTimerRef.current = setTimeout(() => {
        setUndoState(null);
      }, 5000);

      // Reload entire data to keep frontend states synchronized
      await loadData();

      // Check achievements
      const userAfter = await apiService.getCurrentUser();
      const achievementsAfter = userAfter.achievements || [];
      if (user && user.achievements && achievementsAfter.length > user.achievements.length) {
        const newUnlocks = achievementsAfter.filter(
          (after) => !user.achievements.some((before) => before.id === after.id)
        );
        if (newUnlocks.length > 0) {
          setActiveAchievementId(newUnlocks[0].id);
        }
      }
    } catch (error) {
      await triggerHaptic("error");
      console.error("Failed to log drink:", error);
      notify("Fehler beim Loggen", "Das Getränk konnte weder online noch offline geloggt werden. Bitte versuche es erneut.");
    }
  };

  // Undo feature (Schnell-Rückgängig über Undo-Leiste)
  const handleUndo = async () => {
    if (!undoState || undoState.logIds.length === 0) return;
    const { logIds, drinkName, pointsEarned } = undoState;

    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
    }
    setUndoState(null);

    await triggerHaptic("medium");

    // Optimistic rollback
    if (user) {
      updateUserContext({
        ...user,
        points: Math.max(0, user.points - pointsEarned),
      });
    }
    setLogs((prev) => prev.filter((l) => !logIds.includes(l.id)));

    setSuccessBanner(`${drinkName} rückgängig gemacht.`);
    setTimeout(() => setSuccessBanner(null), 3000);

    try {
      await Promise.all(logIds.map((id) => apiService.deleteDrinkLog(id)));
      await loadData();
    } catch (err) {
      console.error("Failed to delete drink log during undo:", err);
      notify("Fehler beim Rückgängigmachen", "Der Eintrag konnte nicht vollständig entfernt werden.");
      await loadData();
    }
  };

  // Portions-Sheet bestätigen
  const handleLogWithPortion = async () => {
    if (!portionOptionsDrink) return;
    const drink = portionOptionsDrink;
    const vol = selectedPortionVolume;
    const count = selectedPortionCount;
    setPortionOptionsDrink(null);

    await handleLogDrink(
      {
        id: drink.id,
        name: drink.name,
        volume: vol,
        abv: drink.abv,
        category: drink.category,
      },
      undefined,
      undefined,
      { count, customVolume: vol }
    );
  };

  // Delete log via API (Undo feature)
  const handleDeleteLog = async (logId: string) => {
    try {
      await triggerHaptic("medium");

      // Optimistic XP bar rollback update
      const logToDelete = logs.find(l => l.id === logId);
      if (logToDelete && user) {
        const drinkDetails = getDrinkDetails(logToDelete.drinkId);
        const isWater = drinkDetails.abv === 0;
        const grams = calculateAlcoholGrams(drinkDetails.volume, drinkDetails.abv);
        let pointsDeducted = isWater ? 10 : 10 + Math.round(grams * 2);
        if (!isWater && katerSchutz.active) {
          pointsDeducted = Math.round(pointsDeducted * 1.25);
        }
        updateUserContext({
          ...user,
          points: Math.max(0, user.points - pointsDeducted),
        });
      }

      // Delete log using apiService (manages both server delete and offline queue automatically)
      await apiService.deleteDrinkLog(logId);

      setSuccessBanner("Drink gelöscht! Werte aktualisiert.");
      setTimeout(() => setSuccessBanner(null), 3000);

      // Reload dashboard data
      await loadData();
    } catch (error) {
      await triggerHaptic("error");
      console.error("Failed to delete drink log:", error);
      notify("Fehler beim Löschen", "Der Eintrag konnte weder online noch offline gelöscht werden. Bitte versuche es erneut.");
    }
  };

  // Save new custom drink
  const handleCreateCustomDrink = async () => {
    if (!formName || !formVolume || !formAbv) {
      await triggerHaptic("error");
      notify("Eingabe ungültig", "Bitte fülle Name, Volumen und Alkoholgehalt aus!");
      return;
    }

    const vol = parseInt(formVolume, 10);
    const abv = parseFloat(formAbv.replace(",", "."));
    const isWater = abv === 0;

    try {
      await triggerHaptic("success");
      const created = await apiService.createDrink({
        name: formName.trim(),
        category: formCategory,
        volume: vol,
        abv: abv,
        calories: isWater ? 0 : Math.round(vol * 0.43),
        // Set when this dialog was opened by an unknown scan: the drink then
        // enters the shared catalogue and the next person to scan that bottle
        // gets it without typing anything.
        ean: pendingEan,
      });

      // Reset form
      setFormName("");
      setFormVolume("");
      setFormAbv("");
      setShowAddModal(false);

      // Wer ein Getränk selbst anlegt, will es benutzen — also direkt in die
      // eigene Schnellwahl. Bei ALLEN anderen taucht es nicht auf; genau das
      // war vorher das Problem.
      if (!myDrinks.some((d) => d.id === created.id) && myDrinks.length < QUICK_PICK_SLOTS) {
        try {
          await apiService.setMyDrinks([...myDrinks.map((d) => d.id), created.id]);
        } catch (e) {
          // Das Getränk existiert bereits — die Schnellwahl ist Beiwerk.
          console.warn("Konnte neues Getränk nicht in die Schnellwahl legen:", e);
        }
      }

      // Reload drinks
      await loadData();

      if (pendingEan) {
        setPendingEan(null);
        // The scan was meant to log a drink, not just catalogue it — so the
        // naming detour ends where the user wanted to be in the first place.
        await handleLogDrink({
          id: created.id,
          name: created.name,
          volume: created.volume,
          abv: created.abv,
          category: created.category,
        });
      }
    } catch (err) {
      console.error("Failed to create custom drink:", err);
      notify("Fehler", "Getränk konnte nicht gespeichert werden.");
    }
  };

  // ── Schnellwahl bearbeiten ────────────────────────────────────────────────
  // Drei Slots in der Oberfläche. Das Serverlimit bleibt bei 12: Konten aus
  // der Migration haben sechs, und ein hartes Kappen würde ihnen beim ersten
  // Speichern die Hälfte wegnehmen. Sie sehen ihre sechs weiter und können
  // im Bearbeiten-Modus selbst auf drei gehen.

  /** Speichert die Reihenfolge; bei einem Fehler bleibt der alte Stand stehen. */
  const persistPicks = async (next: Drink[]) => {
    const previous = myDrinks;
    // Sofort anzeigen: eine Kachel, die erst nach der Serverantwort umspringt,
    // fühlt sich kaputt an.
    setMyDrinks(next);
    setSavingPicks(true);
    try {
      await apiService.setMyDrinks(next.map((d) => d.id));
    } catch (e) {
      setMyDrinks(previous);
      notify("Fehler", e instanceof Error ? e.message : "Auswahl konnte nicht gespeichert werden.");
    } finally {
      setSavingPicks(false);
    }
  };

  const toggleQuickPick = async (drink: Drink) => {
    await triggerHaptic("light");
    const exists = myDrinks.some((d) => d.id === drink.id);

    if (exists) {
      await persistPicks(myDrinks.filter((d) => d.id !== drink.id));
      return;
    }
    if (myDrinks.length >= QUICK_PICK_SLOTS) {
      notify(
        "Schnellwahl voll",
        `Die Schnellwahl hat ${QUICK_PICK_SLOTS} Plätze. Nimm zuerst eines heraus ` +
          "oder such das Getränk über die Kategorien."
      );
      return;
    }
    await persistPicks([...myDrinks, drink]);
  };

  const moveQuickPick = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= myDrinks.length) return;
    await triggerHaptic("light");

    const next = [...myDrinks];
    [next[index], next[target]] = [next[target], next[index]];
    await persistPicks(next);
  };

  // ── Barcode scanning ──────────────────────────────────────────────────────
  const handleScanned = async (ean: string) => {
    setScanBusy(true);
    try {
      const drink = await apiService.lookupDrinkByEan(ean);

      if (drink) {
        setShowScanner(false);
        await handleLogDrink({
          id: drink.id,
          name: drink.name,
          volume: drink.volume,
          abv: drink.abv,
          category: drink.category,
        });

        // Geloggt ist es — aber eine Kachel wird es nur, wenn man das will.
        // Automatisch hinzuzufügen hieße, dass die Schnellwahl bei jeder
        // fremden Flasche zuwächst, und genau das soll sie nicht.
        if (!myDrinks.some((d) => d.id === drink.id) && myDrinks.length < QUICK_PICK_SLOTS) {
          setPendingQuickPick(drink);
        }
        return;
      }

      // Unknown code: hand over to the existing "custom drink" dialog, which
      // already knows how to ask for name, volume and strength.
      setShowScanner(false);
      setPendingEan(ean);
      setFormName("");
      setFormVolume("");
      setFormAbv("");
      setShowAddModal(true);
    } catch (e) {
      notify("Fehler", e instanceof Error ? e.message : "Barcode konnte nicht geprüft werden.");
      setShowScanner(false);
    } finally {
      setScanBusy(false);
    }
  };

  const getCategoryIconChar = (category: string, name?: string) => {
    if (name?.toLowerCase().includes("wasser")) return "💧";
    switch (category) {
      case "Bier": return "🍺";
      case "Wein": return "🍷";
      case "Sekt": return "🥂";
      case "Schnaps": return "🥃";
      case "Mischgetränk": return "🍸";
      default: return "🥤";
    }
  };

  // Ask before deleting a drink log.
  // Alert.alert is a no-op on react-native-web, so the dialog never showed
  // and deleting a drink silently did nothing in the browser.
  const handleToggleDeletePrompt = (logId: string, drinkName: string) => {
    const message = `Möchtest du "${drinkName}" wirklich aus deiner Tagesliste stornieren?`;

    if (Platform.OS === "web") {
      if (window.confirm(message)) handleDeleteLog(logId);
      return;
    }

    Alert.alert("Drink löschen", message, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: () => handleDeleteLog(logId) }
    ]);
  };

  // Drei Spalten, feste Breite — sowohl die Schnellwahl-Slots als auch die
  // Kategorie-Karten liegen im selben Raster.
  const contentWidth = Math.min(screenWidth, 896) - (isDesktop ? 48 : 32);
  const gap = isDesktop ? 16 : 8;
  const tileWidth = (contentWidth - 2 * gap) / 3;
  // Auf breiten Fenstern würde eine Kachel sonst fast quadratisch — 288 px breit
  // und 259 hoch. Gedeckelt bleibt sie eine breite, flache Karte.
  const tileHeight = Math.min(tileWidth * 0.9, 132);

  return (
    <View className="flex-1" style={{ backgroundColor: PAGE_BG }}>
      
      {/* Toast Success Banner */}
      {successBanner && (
        <View className="absolute top-4 left-4 right-4 bg-slate-900/95 border border-cyan-400/40 rounded-2xl p-4 flex-row items-center space-x-3 shadow-2xl z-50">
          <View className="bg-cyan-400/20 p-2 rounded-full">
            <Ionicons name="checkmark-circle" size={20} color="#22d3ee" />
          </View>
          <Text className="text-white text-xs font-black flex-1 ml-2">{successBanner}</Text>
        </View>
      )}

      {/* Floating point indicators */}
      {floatingPoints.map((pt) => (
        <FloatingPointItem
          key={pt.id}
          id={pt.id}
          x={pt.x}
          y={pt.y}
          text={pt.text}
          onComplete={(id) => setFloatingPoints((prev) => prev.filter((p) => p.id !== id))}
        />
      ))}

      <ScrollView
        className="flex-1"
        contentContainerClassName={isDesktop ? "px-6 pt-6 pb-4" : "px-4 pt-4 pb-2"}
        showsVerticalScrollIndicator={false}
      >
        {/* Auf breiten Fenstern zentriert und begrenzt: eine Dashboard-Spalte,
            die sich über 2000 px zieht, liest sich nicht besser, nur weiter. */}
        <View className="w-full self-center" style={{ maxWidth: 896 }}>

        {/* ==========================================
            1. HERO — Stats kompakt in einer Leiste
            ==========================================
            Vorher: Begrüßung, Rang-Badge, XP-Karte und Hydrations-Karte als
            vier gestapelte Blöcke. Zusammen füllten sie den ersten Bildschirm,
            bevor man ein einziges Getränk loggen konnte. */}
        {user && (() => {
          const currentLevel = user.currentLevel || user.level || 1;
          const xpProgress = user.xpProgressInCurrentLevel !== undefined ? user.xpProgressInCurrentLevel : 0;
          const xpNeeded = user.xpForNextLevel || 100;
          const fillPercentage = xpNeeded > 0 ? Math.min(100, (xpProgress / xpNeeded) * 100) : 0;
          const rank = getRankBadgeStyles(user.rank);

          return (
            <View className="mb-4 rounded-2xl border border-slate-800 p-4" style={{ backgroundColor: CARD_BG }}>
              <View className="flex-row items-center">
                <View className="flex-1 pr-3">
                  <Text className="text-white text-base font-black tracking-wide" numberOfLines={1}>
                    {user.name || "Dein Benutzername"}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    <Ionicons name="ribbon" size={12} color={rank.color} />
                    <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider ml-1">
                      {rank.label} · Lv. {currentLevel}
                    </Text>
                  </View>
                </View>

                {/* Hydration als Abzeichen statt als eigene Karte. Der aktive
                    Kater-Schutz ist zeitkritisch, deshalb steht die Restzeit
                    direkt darin. */}
                <View
                  className={`flex-row items-center px-2.5 py-1.5 rounded-xl border mr-2 ${
                    katerSchutz.active
                      ? "bg-emerald-500/10 border-emerald-400/30"
                      : "bg-slate-950 border-slate-800"
                  }`}
                >
                  <Ionicons
                    name={katerSchutz.active ? "shield-checkmark" : "water-outline"}
                    size={13}
                    color={katerSchutz.active ? "#10B981" : "#38bdf8"}
                  />
                  <Text
                    className={`text-[10px] font-black ml-1 ${
                      katerSchutz.active ? "text-emerald-400" : "text-sky-400"
                    }`}
                  >
                    {katerSchutz.active ? `${katerSchutz.minutesLeft} Min` : "Wasser?"}
                  </Text>
                </View>
              </View>

              <View className="mt-3">
                <View className="flex-row justify-between items-center mb-1.5">
                  <Text className="text-slate-500 text-[9px] font-black uppercase tracking-wider">
                    {xpProgress}/{xpNeeded} XP
                  </Text>
                  <Text className="text-slate-500 text-[9px] font-black">{user.points} gesamt</Text>
                </View>
                <View className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                  <View style={{ width: `${fillPercentage}%` }} className="h-full bg-cyan-400 rounded-full" />
                </View>
              </View>
            </View>
          );
        })()}

        {/* Level-Up bleibt eine eigene Karte: sie erscheint selten, ist dann
            aber die wichtigste Sache auf dem Bildschirm. */}
        {user && (user.isLevelLocked || (user.points >= getCumulativeXpForLevel(user.level || 1) + Math.floor(Math.pow(user.level || 1, 1.5) * 100))) && user.active_quest && (
          <View className="mb-4 bg-slate-900 border border-amber-500/40 rounded-2xl p-4">
            <View className="flex-row items-center mb-2.5">
              <Ionicons name="flame" size={18} color="#fbbf24" />
              <Text className="text-white text-sm font-black tracking-wide ml-2 flex-1">
                Bereit für Level {(user.level || 1) + 1}?
              </Text>
            </View>
            <View className="bg-slate-950 border border-slate-800 p-3 rounded-xl mb-3">
              <Text className="text-amber-400 text-[11px] font-black text-center italic">
                &quot;{user.active_quest}&quot;
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleLevelUp}
              disabled={isLevelingUp}
              className="w-full bg-amber-400 py-3 rounded-xl items-center flex-row justify-center disabled:opacity-50"
            >
              {isLevelingUp ? (
                <ActivityIndicator size="small" color="#020617" />
              ) : (
                <>
                  <Ionicons name="checkmark-done" size={15} color="#020617" />
                  <Text className="text-slate-950 font-black text-[11px] uppercase tracking-wider ml-1.5">
                    Quest abschließen
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ==========================================
            QUESTS & DUELLE WIDGET
            ========================================== */}
        <View className="mb-5">
          <View className="flex-row items-center justify-between mb-2.5">
            <View className="flex-row items-center">
              <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mr-2">
                Duelle & Quests
              </Text>
              {hasActiveChallenges && (
                <View className="bg-amber-400/15 border border-amber-400/30 px-2 py-0.5 rounded-full">
                  <Text className="text-amber-400 text-[8px] font-black uppercase tracking-wider">
                    {relevantDuels.length + activeQuests.length} aktiv
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                router.push("/games");
              }}
              accessibilityLabel="Zu den Spielen und Duellen"
              className="flex-row items-center"
            >
              <Text className="text-cyan-400 text-[10px] font-black uppercase tracking-wider mr-1">
                Alle Spiele
              </Text>
              <Ionicons name="chevron-forward" size={11} color="#22d3ee" />
            </TouchableOpacity>
          </View>

          {hasActiveChallenges ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="-mx-1"
              contentContainerStyle={{ paddingHorizontal: 4, gap: 10 }}
            >
              {/* 1. Duelle Cards */}
              {relevantDuels.map((duel) => {
                const isCreator = user && duel.creatorId === user.id;
                const oppId = isCreator ? duel.opponentId : duel.creatorId;
                const opponent = allUsers.find((u) => u.id === oppId);
                const oppName = opponent ? opponent.name : "Freund";
                const myScore = isCreator ? duel.creatorPoints : duel.opponentPoints;
                const oppScore = isCreator ? duel.opponentPoints : duel.creatorPoints;
                const isLeading = myScore > oppScore;
                const isTie = myScore === oppScore;
                const isPending = duel.status === "pending";
                const timeLeft = duel.endTime ? formatRemainingTime(duel.endTime) : `${duel.duration} Min`;

                return (
                  <TouchableOpacity
                    key={duel.id}
                    activeOpacity={0.85}
                    onPress={() => {
                      triggerHaptic("light");
                      router.push("/games");
                    }}
                    style={{ width: isDesktop ? 340 : screenWidth * 0.72, backgroundColor: CARD_BG }}
                    className="border border-amber-500/30 rounded-2xl p-3.5 justify-between"
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center">
                        <View className="w-6 h-6 rounded-lg bg-amber-400/15 border border-amber-400/30 items-center justify-center mr-2">
                          <Ionicons name="trophy" size={12} color="#fbbf24" />
                        </View>
                        <Text className="text-amber-400 text-[10px] font-black uppercase tracking-wider">
                          {isPending ? "Herausforderung" : "1v1 Duell"}
                        </Text>
                      </View>
                      <View className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md">
                        <Text className="text-slate-400 text-[9px] font-bold">
                          {timeLeft}
                        </Text>
                      </View>
                    </View>

                    <View className="mb-2.5">
                      <Text className="text-white text-xs font-black" numberOfLines={1}>
                        vs. {oppName}
                      </Text>
                      {isPending ? (
                        <Text className="text-cyan-400 text-[10px] font-bold mt-0.5">
                          Tippe zum Annehmen ⚔️
                        </Text>
                      ) : (
                        <View className="flex-row items-center justify-between mt-1">
                          <Text className="text-amber-300 text-sm font-black tracking-wider">
                            Du {myScore} : {oppScore} {oppName.split(" ")[0]}
                          </Text>
                          <Text
                            className={`text-[9px] font-black uppercase ${
                              isLeading ? "text-emerald-400" : isTie ? "text-amber-400" : "text-rose-400"
                            }`}
                          >
                            {isLeading ? "Führung! 👑" : isTie ? "Gleichstand" : "Rückstand"}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View className="pt-2 border-t border-white/5 flex-row items-center justify-between">
                      <Text className="text-slate-500 text-[9px] font-bold">
                        {isPending ? "Wartet auf Start" : "Live-Punkterennen"}
                      </Text>
                      <View className="flex-row items-center">
                        <Text className="text-amber-400 text-[9px] font-black uppercase mr-1">
                          Zum Duell
                        </Text>
                        <Ionicons name="arrow-forward" size={10} color="#fbbf24" />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* 2. Group Quests Cards */}
              {activeQuests.map((quest) => {
                const progressPct = quest.targetValue > 0 ? Math.min(100, Math.round((quest.currentValue / quest.targetValue) * 100)) : 0;
                const timeLeft = formatRemainingTime(quest.endTime);

                return (
                  <TouchableOpacity
                    key={quest.id}
                    activeOpacity={0.85}
                    onPress={() => {
                      triggerHaptic("light");
                      router.push("/games");
                    }}
                    style={{ width: isDesktop ? 340 : screenWidth * 0.72, backgroundColor: CARD_BG }}
                    className="border border-cyan-500/30 rounded-2xl p-3.5 justify-between"
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center">
                        <View className="w-6 h-6 rounded-lg bg-cyan-400/15 border border-cyan-400/30 items-center justify-center mr-2">
                          <Ionicons name="flag" size={12} color="#22d3ee" />
                        </View>
                        <Text className="text-cyan-400 text-[10px] font-black uppercase tracking-wider">
                          Gruppen-Quest
                        </Text>
                      </View>
                      {timeLeft ? (
                        <View className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md">
                          <Text className="text-slate-400 text-[9px] font-bold">
                            {timeLeft}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View className="mb-2.5">
                      <Text className="text-white text-xs font-black mb-1.5" numberOfLines={1}>
                        {quest.title}
                      </Text>
                      <View className="flex-row justify-between items-center mb-1">
                        <Text className="text-slate-400 text-[9px] font-bold">
                          Fortschritt
                        </Text>
                        <Text className="text-cyan-300 text-[9px] font-black">
                          {quest.currentValue}/{quest.targetValue} ({progressPct}%)
                        </Text>
                      </View>
                      <View className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                        <View style={{ width: `${progressPct}%` }} className="h-full bg-cyan-400 rounded-full" />
                      </View>
                    </View>

                    <View className="pt-2 border-t border-white/5 flex-row items-center justify-between">
                      <Text className="text-slate-500 text-[9px] font-bold">
                        Gemeinsam lösen
                      </Text>
                      <View className="flex-row items-center">
                        <Text className="text-cyan-400 text-[9px] font-black uppercase mr-1">
                          Details
                        </Text>
                        <Ionicons name="arrow-forward" size={10} color="#22d3ee" />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            /* Fallback CTA if no active duels or group quests */
            <View className="flex-row gap-2.5">
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  triggerHaptic("light");
                  router.push("/games");
                }}
                style={{ backgroundColor: CARD_BG }}
                className="flex-1 border border-slate-800 rounded-2xl p-3 flex-row items-center"
              >
                <View className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 items-center justify-center mr-2.5">
                  <Ionicons name="trophy-outline" size={16} color="#fbbf24" />
                </View>
                <View className="flex-1">
                  <Text className="text-white text-[11px] font-black" numberOfLines={1}>
                    1v1 Duell
                  </Text>
                  <Text className="text-slate-400 text-[9px] font-bold mt-0.5">
                    Freunde fordern
                  </Text>
                </View>
                <Ionicons name="add" size={14} color="#64748b" />
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  triggerHaptic("light");
                  router.push("/games");
                }}
                style={{ backgroundColor: CARD_BG }}
                className="flex-1 border border-slate-800 rounded-2xl p-3 flex-row items-center"
              >
                <View className="w-8 h-8 rounded-xl bg-cyan-400/10 border border-cyan-400/20 items-center justify-center mr-2.5">
                  <Ionicons name="flag-outline" size={16} color="#22d3ee" />
                </View>
                <View className="flex-1">
                  <Text className="text-white text-[11px] font-black" numberOfLines={1}>
                    Quests
                  </Text>
                  <Text className="text-slate-400 text-[9px] font-bold mt-0.5">
                    Gruppen-Ziele
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color="#64748b" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ==========================================
            2. PRIMÄRER CTA — Scannen
            ==========================================
            Der schnellste Weg zu einem Log führt über den Barcode, also steht
            er oben und nicht als einer von zwei gleich großen Knöpfen unten. */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            triggerHaptic("light");
            setShowScanner(true);
          }}
          accessibilityLabel="Getränk scannen"
          className="mb-5 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 flex-row items-center px-4 py-4"
        >
          <View className="bg-cyan-400 rounded-xl p-2.5">
            <Ionicons name="barcode-outline" size={22} color="#020617" />
          </View>
          <View className="flex-1 ml-3.5">
            <Text className="text-cyan-300 text-sm font-black uppercase tracking-wider">
              Getränk scannen
            </Text>
            <Text className="text-cyan-400/60 text-[10px] font-bold mt-0.5">
              Barcode einlesen und sofort eintragen
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#22d3ee" />
        </TouchableOpacity>

        {/* Check-in. Nur im Modus „Nur bei Check-in" — bei „Automatisch"
            passiert es von selbst, bei „Aus" soll es gar nicht angeboten
            werden. */}
        {locationMode === "manual" && (
          <View
            className={`mb-5 rounded-2xl border p-3.5 flex-row items-center ${
              checkInAktiv
                ? "bg-emerald-500/10 border-emerald-400/30"
                : "border-slate-800"
            }`}
            style={checkInAktiv ? undefined : { backgroundColor: CARD_BG }}
          >
            <Ionicons
              name={checkInAktiv ? "location" : "location-outline"}
              size={18}
              color={checkInAktiv ? "#10B981" : "#64748b"}
            />
            <View className="flex-1 ml-3">
              <Text
                className={`text-[11px] font-black uppercase tracking-wider ${
                  checkInAktiv ? "text-emerald-400" : "text-slate-400"
                }`}
              >
                {checkInAktiv ? "Eingecheckt" : "Check-in"}
              </Text>
              <Text className="text-slate-500 text-[10px] font-bold mt-0.5 leading-3.5">
                {checkInAktiv
                  ? "Dein nächstes Getränk bekommt diesen Ort."
                  : "Ort einmalig festhalten — nur für dein nächstes Getränk."}
              </Text>
            </View>

            {checkInBusy ? (
              <ActivityIndicator size="small" color="#10B981" />
            ) : checkInAktiv ? (
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  setCheckIn(null);
                }}
                accessibilityLabel="Check-in verwerfen"
                className="px-3 py-1.5"
              >
                <Text className="text-slate-400 text-[10px] font-black uppercase">Verwerfen</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleCheckIn}
                accessibilityLabel="Jetzt einchecken"
                className="bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-1.5 rounded-xl"
              >
                <Text className="text-emerald-400 text-[10px] font-black uppercase">Einchecken</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {/* ==========================================
            3. SCHNELLWAHL — drei Slots, ein Tipp
            ========================================== */}
        <View className="flex-row items-center justify-between mb-2.5">
          <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider">
            Deine Favoriten
          </Text>
          <View className="flex-row items-center">
            {savingPicks && <ActivityIndicator color="#22d3ee" size="small" className="mr-3" />}
            {myDrinks.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic("light");
                  setEditMode((on) => !on);
                }}
                accessibilityLabel={editMode ? "Bearbeiten beenden" : "Favoriten bearbeiten"}
                className={`px-3 py-1.5 rounded-xl border ${
                  editMode ? "bg-cyan-400/10 border-cyan-400/40" : "bg-slate-950 border-slate-800"
                }`}
              >
                <Text
                  className={`text-[10px] font-black uppercase tracking-wider ${
                    editMode ? "text-cyan-400" : "text-slate-400"
                  }`}
                >
                  {editMode ? "Fertig" : "Bearbeiten"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View className="flex-row flex-wrap mb-5" style={{ gap }}>
          {myDrinks.map((item, index) => {
            const accent = accentForCategory(item.category);
            return (
              <View key={item.id} style={{ width: tileWidth }}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={(e) =>
                    editMode ? undefined : handleLogDrink(item, e.nativeEvent.pageX, e.nativeEvent.pageY)
                  }
                  onLongPress={() => {
                    if (!editMode) {
                      triggerHaptic("medium");
                      setPortionOptionsDrink(item);
                      setSelectedPortionVolume(item.volume);
                      setSelectedPortionCount(1);
                    }
                  }}
                  delayLongPress={350}
                  disabled={editMode}
                  accessibilityLabel={`${item.name} eintragen (lange drücken für Optionen)`}
                  style={{ height: tileHeight, backgroundColor: CARD_BG, borderColor: `${accent}40` }}
                  className="border rounded-2xl p-2 items-center justify-center mb-1"
                >
                  <Text className="text-2xl mb-1">{getCategoryIconChar(item.category, item.name)}</Text>
                  <Text className="text-white text-[11px] font-black text-center" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text className="text-slate-500 text-[9px] font-bold mt-0.5">
                    {(item.volume / 1000).toFixed(2)}l · {item.abv}%
                  </Text>
                </TouchableOpacity>

                {editMode && (
                  <View className="flex-row justify-between mb-1">
                    <TouchableOpacity
                      onPress={() => moveQuickPick(index, -1)}
                      disabled={index === 0}
                      accessibilityLabel={`${item.name} nach vorne`}
                      className="flex-1 py-1.5 items-center rounded-lg bg-slate-950 border border-slate-800 mr-0.5 disabled:opacity-30"
                    >
                      <Ionicons name="chevron-back" size={12} color="#94a3b8" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => toggleQuickPick(item)}
                      accessibilityLabel={`${item.name} aus den Favoriten entfernen`}
                      className="flex-1 py-1.5 items-center rounded-lg bg-rose-500/10 border border-rose-500/30 mx-0.5"
                    >
                      <Ionicons name="close" size={12} color="#f43f5e" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveQuickPick(index, 1)}
                      disabled={index === myDrinks.length - 1}
                      accessibilityLabel={`${item.name} nach hinten`}
                      className="flex-1 py-1.5 items-center rounded-lg bg-slate-950 border border-slate-800 ml-0.5 disabled:opacity-30"
                    >
                      <Ionicons name="chevron-forward" size={12} color="#94a3b8" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          {/* Leere Slots auffüllen, damit die Reihe immer drei Plätze zeigt —
              ein einzelner Favorit soll nicht wie ein Fehler aussehen. */}
          {Array.from({ length: Math.max(0, QUICK_PICK_SLOTS - myDrinks.length) }).map((_, idx) => (
            <TouchableOpacity
              key={`slot-${idx}`}
              activeOpacity={0.8}
              onPress={() => {
                triggerHaptic("light");
                setDrinkSearch("");
                setPickerCategory(null);
                setShowPickerModal(true);
              }}
              accessibilityLabel="Favorit hinzufügen"
              style={{ width: tileWidth, height: tileHeight }}
              className="border border-dashed border-slate-700 rounded-2xl items-center justify-center mb-1"
            >
              <Ionicons name="add" size={20} color="#475569" />
              <Text className="text-slate-600 text-[9px] font-black uppercase tracking-wider mt-1 text-center px-1">
                Favorit
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Angebot nach einem Scan. Bewusst ein Streifen und kein Dialog: das
            Getränk ist schon geloggt, die Frage darf niemanden aufhalten. */}
        {pendingQuickPick && (
          <View className="mb-5 bg-cyan-400/10 border border-cyan-400/30 rounded-2xl p-3.5 flex-row items-center">
            <Ionicons name="add-circle-outline" size={18} color="#22d3ee" />
            <Text className="text-cyan-300/90 text-[11px] leading-4 ml-2.5 flex-1">
              „{pendingQuickPick.name}“ zu den Favoriten?
            </Text>
            <TouchableOpacity
              onPress={() => setPendingQuickPick(null)}
              accessibilityLabel="Nicht hinzufügen"
              className="px-3 py-1.5"
            >
              <Text className="text-slate-400 text-[10px] font-black uppercase">Nein</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                const drink = pendingQuickPick;
                setPendingQuickPick(null);
                await toggleQuickPick(drink);
              }}
              accessibilityLabel={`${pendingQuickPick.name} zu den Favoriten hinzufügen`}
              className="bg-cyan-400 px-3 py-1.5 rounded-xl"
            >
              <Text className="text-slate-950 text-[10px] font-black uppercase">Ja</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ==========================================
            4. KATEGORIEN — vier Reiter, drei Karten
            ==========================================
            Ersetzt die Kachelwand über den gesamten Katalog. Was hier steht,
            sind die drei Getränke der Kategorie, die dieser Nutzer am
            häufigsten trinkt; alles Weitere liegt hinter der Suche. */}
        <View className="flex-row mb-3" style={{ gap: 6 }}>
          {CATEGORY_TABS.map((tab) => {
            const active = activeCategory === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.8}
                onPress={() => {
                  triggerHaptic("light");
                  setActiveCategory(tab.key);
                }}
                accessibilityLabel={`Kategorie ${tab.label}`}
                style={{
                  backgroundColor: active ? `${tab.accent}1A` : CARD_BG,
                  borderColor: active ? `${tab.accent}66` : "#1e293b",
                }}
                className="flex-1 border rounded-xl py-2.5 items-center"
              >
                <Text className="text-base">{tab.icon}</Text>
                <Text
                  className="text-[9px] font-black uppercase tracking-wider mt-0.5"
                  style={{ color: active ? tab.accent : "#64748b" }}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {categoryCards.length === 0 ? (
          <View className="py-8 items-center rounded-2xl border border-slate-800" style={{ backgroundColor: CARD_BG }}>
            <Text className="text-slate-500 text-[11px] font-bold">Hier ist noch nichts hinterlegt.</Text>
          </View>
        ) : (
          <View className={isDesktop ? "flex-row" : ""} style={isDesktop ? { gap } : undefined}>
            {categoryCards.map((item) => {
              const accent = accentForCategory(item.category);
              const chosen = myDrinks.some((d) => d.id === item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.8}
                  onPress={(e) => handleLogDrink(item, e.nativeEvent.pageX, e.nativeEvent.pageY)}
                  onLongPress={() => {
                    triggerHaptic("medium");
                    setPortionOptionsDrink(item);
                    setSelectedPortionVolume(item.volume);
                    setSelectedPortionCount(1);
                  }}
                  delayLongPress={350}
                  accessibilityLabel={`${item.name} eintragen (lange drücken für Optionen)`}
                  style={{ backgroundColor: CARD_BG, borderColor: `${accent}33` }}
                  className={`border rounded-2xl px-3.5 py-3 flex-row items-center mb-2 ${isDesktop ? "flex-1" : ""}`}
                >
                  <Text className="text-xl">{getCategoryIconChar(item.category, item.name)}</Text>
                  <View className="flex-1 ml-3">
                    <Text className="text-white text-xs font-black" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="text-slate-500 text-[9px] font-bold mt-0.5">
                      {(item.volume / 1000).toFixed(2)}l · {item.abv}% Vol.
                    </Text>
                  </View>
                  {chosen ? (
                    <Ionicons name="star" size={14} color={accent} />
                  ) : (
                    <View style={{ backgroundColor: `${accent}1A` }} className="p-1.5 rounded-lg">
                      <Ionicons name="add" size={14} color={accent} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            triggerHaptic("light");
            setDrinkSearch("");
            setPickerCategory(activeCategory);
            setShowPickerModal(true);
          }}
          accessibilityLabel={`Alle ${activeCategoryLabel} anzeigen und suchen`}
          className="mt-1 mb-8 flex-row items-center justify-center py-3"
        >
          <Ionicons name="search-outline" size={13} color="#64748b" />
          <Text className="text-slate-500 text-[10px] font-black uppercase tracking-wider ml-1.5">
            Alle {activeCategoryLabel} anzeigen ({categoryTotal})
          </Text>
        </TouchableOpacity>

        {/* ==========================================
            6. RECENT LOGS SECTION (LAST 3 + UNDO)
            ========================================== */}
        <View className="mb-12">
          <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-3">Letzte 3 Drinks</Text>
          
          {lastThreeLogs.length === 0 ? (
            <View className="bg-slate-900/10 border border-dashed border-slate-800 rounded-3xl p-6 items-center">
              <Ionicons name="beer-outline" size={20} color="#334155" className="mb-1.5" />
              <Text className="text-slate-500 text-[9px] font-black uppercase tracking-wider text-center">
                Noch keine Drinks eingetragen
              </Text>
            </View>
          ) : (
            lastThreeLogs.map((log) => {
              const details = getDrinkDetails(log.drinkId);
              const logTime = new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              return (
                <View
                  key={log.id}
                  style={{ backgroundColor: CARD_BG }}
                  className="flex-row items-center justify-between border border-slate-800 rounded-2xl p-3.5 mb-2"
                >
                  <View className="flex-1 pr-4">
                    <Text className="text-white text-xs font-black">{details.name}</Text>
                    <Text className="text-slate-500 text-[9px] font-bold mt-0.5">
                      {(details.volume / 1000).toFixed(2)}l • {details.abv}% Vol. • {logTime} Uhr
                    </Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handleToggleDeletePrompt(log.id, details.name)}
                    className="bg-slate-950 p-2.5 rounded-xl border border-rose-500/20 active:bg-rose-500/15"
                  >
                    <Ionicons name="close" size={16} color="#f43f5e" />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        </View>
      </ScrollView>

      {/* ==========================================
          MODAL: GETRÄNKE WÄHLEN
          ==========================================
          Der vollständige Katalog. Vorher gab es diese Ansicht nicht — alles
          stand direkt im Dashboard, weshalb dort jedes je angelegte Getränk
          landete. */}
      <Modal
        visible={showPickerModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPickerModal(false)}
      >
        <View className="flex-1 bg-black/80 justify-end">
          <View className="bg-slate-950 border-t border-white/10 rounded-t-3xl p-6 pb-10 max-h-[85%]">
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-white text-base font-black uppercase tracking-wider">
                {pickerCategory ? activeCategoryLabel : "Alle Getränke"}
              </Text>
              <TouchableOpacity onPress={() => setShowPickerModal(false)} className="p-1">
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text className="text-slate-500 text-[10px] font-semibold mb-4">
              Antippen trägt ein · Stern macht zum Favoriten ({myDrinks.length}/{QUICK_PICK_SLOTS})
            </Text>

            <View className="bg-slate-900 border border-white/5 rounded-2xl flex-row items-center px-4 py-3 mb-4">
              <Ionicons name="search" size={16} color="#475569" />
              <TextInput
                placeholder={pickerCategory ? "Im ganzen Katalog suchen…" : "Getränk suchen…"}
                placeholderTextColor="#475569"
                value={drinkSearch}
                onChangeText={setDrinkSearch}
                className="flex-1 text-white font-bold text-sm ml-3"
              />
              {drinkSearch.length > 0 && (
                <TouchableOpacity onPress={() => setDrinkSearch("")} accessibilityLabel="Suche leeren">
                  <Ionicons name="close-circle" size={16} color="#475569" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView className="mb-4">
              {catalogSearchResults.length === 0 ? (
                <View className="py-10 items-center">
                  <Text className="text-slate-500 text-xs font-bold text-center">
                    Nichts gefunden. Lege das Getränk unten selbst an oder scanne den Barcode.
                  </Text>
                </View>
              ) : (
                catalogSearchResults.map((item) => {
                  const chosen = myDrinks.some((d) => d.id === item.id);
                  const accent = accentForCategory(item.category);
                  return (
                    <View
                      key={item.id}
                      className="flex-row items-center rounded-2xl mb-2 border pr-2"
                      style={{
                        backgroundColor: chosen ? `${accent}14` : CARD_BG,
                        borderColor: chosen ? `${accent}66` : "#1e293b",
                      }}
                    >
                      {/* Antippen trägt ein. Das ist der häufigere Wunsch: wer
                          die Liste öffnet, will meistens etwas trinken, nicht
                          seine Favoriten umbauen. */}
                      <TouchableOpacity
                        onPress={(e) => {
                          setShowPickerModal(false);
                          handleLogDrink(item, e.nativeEvent.pageX, e.nativeEvent.pageY);
                        }}
                        accessibilityLabel={`${item.name} eintragen`}
                        className="flex-1 flex-row items-center px-4 py-3"
                      >
                        <Text className="text-lg mr-3">
                          {getCategoryIconChar(item.category, item.name)}
                        </Text>
                        <View className="flex-1">
                          <Text className="text-white text-xs font-black" numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text className="text-slate-500 text-[9px] font-bold mt-0.5">
                            {(item.volume / 1000).toFixed(2)}l · {item.abv}% · {item.category}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {/* Favorisieren ist die zweite, seltenere Handlung und
                          bekommt deshalb einen eigenen Knopf statt der ganzen
                          Zeile. */}
                      <TouchableOpacity
                        onPress={() => toggleQuickPick(item)}
                        accessibilityLabel={`${item.name} ${
                          chosen ? "aus den Favoriten entfernen" : "zu den Favoriten hinzufügen"
                        }`}
                        className="p-2.5"
                      >
                        <Ionicons
                          name={chosen ? "star" : "star-outline"}
                          size={18}
                          color={chosen ? accent : "#475569"}
                        />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                setShowPickerModal(false);
                setPendingEan(null);
                setShowAddModal(true);
              }}
              className="w-full bg-slate-900 border border-white/10 py-3.5 rounded-2xl items-center active:scale-95"
            >
              <Text className="text-slate-300 font-black text-xs uppercase tracking-wider">
                + Eigenes Getränk anlegen
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ==========================================
          MODAL: CUSTOM DRINK CREATOR
          ========================================== */}
      <Modal visible={showAddModal} transparent={true} animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View className="flex-1 bg-black/80 justify-end">
          <View className="bg-slate-950 border-t border-white/10 rounded-t-3xl p-6 pb-10">
            <View className="flex-row justify-between items-center mb-5">
              <Text className="text-white text-base font-black uppercase tracking-wider">
                {pendingEan ? "Neues Getränk benennen" : "Eigenes Getränk erstellen"}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setPendingEan(null);
                  setShowAddModal(false);
                }}
                className="p-1"
              >
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {pendingEan && (
              <View className="bg-cyan-400/10 border border-cyan-400/20 rounded-2xl p-3.5 mb-4 flex-row">
                <Ionicons name="barcode-outline" size={16} color="#22d3ee" />
                <Text className="text-cyan-300/90 text-[11px] leading-4 ml-2.5 flex-1">
                  Diesen Barcode kennen wir noch nicht ({pendingEan}). Sag uns, was es ist — dann
                  findet ihn beim nächsten Mal jeder sofort.
                </Text>
              </View>
            )}

            {/* Drink Name */}
            <Text className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1.5">Getränke-Name</Text>
            <TextInput
              placeholder="z. B. Craft Beer, Hauswein, Gin Tonic"
              placeholderTextColor="#475569"
              value={formName}
              onChangeText={setFormName}
              className="bg-slate-900 border border-white/5 rounded-2xl px-4 py-3.5 text-white font-bold text-sm mb-4"
            />

            {/* Category Select */}
            <Text className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1.5">Kategorie</Text>
            <View className="flex-row flex-wrap gap-1.5 mb-4">
              {([
                { key: "Bier", label: "Biere" },
                { key: "Wein", label: "Weine" },
                { key: "Mischgetränk", label: "Cocktails" },
                { key: "Alkoholfrei", label: "Alkoholfrei" }
              ] as const).map((cat) => {
                const isActive = formCategory === cat.key;
                return (
                  <TouchableOpacity
                    key={cat.key}
                    onPress={() => {
                      triggerHaptic("light");
                      setFormCategory(cat.key);
                      if (cat.key === "Alkoholfrei") {
                        setFormAbv("0.0");
                      }
                    }}
                    className={`px-3 py-2.5 rounded-xl border ${
                      isActive ? "bg-cyan-400/10 border-cyan-400/35" : "bg-slate-900 border-white/5"
                    }`}
                  >
                    <Text className={`text-xs font-black uppercase tracking-wider ${isActive ? "text-cyan-400" : "text-slate-400"}`}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Volume in ml */}
            <Text className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1.5">Menge (ml)</Text>
            <TextInput
              placeholder="z. B. 330, 500"
              placeholderTextColor="#475569"
              keyboardType="number-pad"
              value={formVolume}
              onChangeText={setFormVolume}
              className="bg-slate-900 border border-white/5 rounded-2xl px-4 py-3.5 text-white font-bold text-sm mb-4"
            />

            {/* ABV */}
            <Text className="text-slate-500 text-[10px] font-black uppercase tracking-wider mb-1.5">Alkoholgehalt (% Vol.)</Text>
            <TextInput
              placeholder="z. B. 4.9"
              placeholderTextColor="#475569"
              keyboardType="decimal-pad"
              editable={formCategory !== "Alkoholfrei"}
              value={formCategory === "Alkoholfrei" ? "0.0" : formAbv}
              onChangeText={setFormAbv}
              className="bg-slate-900 border border-white/5 rounded-2xl px-4 py-3.5 text-white font-bold text-sm mb-6"
            />

            {/* Action buttons */}
            {isValuesTooHigh && (
              <View className="mb-4 bg-rose-500/10 border border-rose-500/20 p-3 rounded-2xl flex-row items-center space-x-2">
                <Ionicons name="warning" size={16} color="#ef4444" />
                <Text className="text-rose-500 text-xs font-black">Werte zu hoch!</Text>
              </View>
            )}

            <View className="flex-row space-x-3">
              <TouchableOpacity
                onPress={() => setShowAddModal(false)}
                className="flex-1 bg-slate-900 border border-white/5 py-4 rounded-2xl items-center"
              >
                <Text className="text-slate-400 font-black text-xs uppercase tracking-wider">Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreateCustomDrink}
                disabled={isValuesTooHigh}
                className={`flex-1 py-4 rounded-2xl items-center shadow-lg ${
                  isValuesTooHigh
                    ? "bg-slate-800 shadow-none opacity-40"
                    : "bg-cyan-400 shadow-cyan-500/20 active:scale-95"
                }`}
              >
                <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">Speichern</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Achievement Unlocked Announcement Modal */}
      {user && (
        <AchievementModal
          achievementId={activeAchievementId}
          onClose={() => setActiveAchievementId(null)}
        />
      )}

      {showScanner && (
        <React.Suspense fallback={null}>
          <BarcodeScanner
            visible={showScanner}
            busy={scanBusy}
            onClose={() => setShowScanner(false)}
            onScanned={handleScanned}
          />
        </React.Suspense>
      )}

      {/* ==========================================
          MODAL: PORTION & MENGEN-OPTIONEN (LONG PRESS)
          ========================================== */}
      <Modal
        visible={!!portionOptionsDrink}
        transparent
        animationType="slide"
        onRequestClose={() => setPortionOptionsDrink(null)}
      >
        <View className="flex-1 bg-black/80 justify-end">
          <View className="bg-slate-950 border-t border-white/10 rounded-t-3xl p-6 pb-10 max-h-[85%]">
            {portionOptionsDrink && (() => {
              const accent = accentForCategory(portionOptionsDrink.category);
              const presets = getVolumePresets(portionOptionsDrink.category, portionOptionsDrink.volume);
              const isWater = portionOptionsDrink.abv === 0;
              const gramsPerDrink = calculateAlcoholGrams(selectedPortionVolume, portionOptionsDrink.abv);
              let singlePoints = isWater ? 10 : 10 + Math.round(gramsPerDrink * 2);
              if (!isWater && katerSchutz.active) {
                singlePoints = Math.round(singlePoints * 1.25);
              }
              const totalEstimatedPoints = singlePoints * selectedPortionCount;

              return (
                <>
                  <View className="flex-row justify-between items-center mb-4">
                    <View className="flex-row items-center flex-1 mr-2">
                      <Text className="text-2xl mr-2.5">
                        {getCategoryIconChar(portionOptionsDrink.category, portionOptionsDrink.name)}
                      </Text>
                      <View className="flex-1">
                        <Text className="text-white text-base font-black uppercase tracking-wider" numberOfLines={1}>
                          {portionOptionsDrink.name}
                        </Text>
                        <Text className="text-slate-400 text-[10px] font-bold">
                          {portionOptionsDrink.category} · {portionOptionsDrink.abv}% Vol.
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setPortionOptionsDrink(null)} className="p-1">
                      <Ionicons name="close" size={24} color="#64748b" />
                    </TouchableOpacity>
                  </View>

                  {/* Portionsgröße / Volumen */}
                  <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">
                    Portionsgröße
                  </Text>
                  <View className="flex-row flex-wrap gap-2 mb-4">
                    {presets.map((preset) => {
                      const isSelected = selectedPortionVolume === preset.volume;
                      return (
                        <TouchableOpacity
                          key={`vol-${preset.volume}`}
                          onPress={() => {
                            triggerHaptic("light");
                            setSelectedPortionVolume(preset.volume);
                          }}
                          style={{
                            backgroundColor: isSelected ? `${accent}20` : CARD_BG,
                            borderColor: isSelected ? accent : "#334155",
                          }}
                          className="border px-3.5 py-2.5 rounded-xl flex-row items-center"
                        >
                          <Text
                            className="text-xs font-black"
                            style={{ color: isSelected ? accent : "#cbd5e1" }}
                          >
                            {preset.label}
                          </Text>
                          {preset.volume === portionOptionsDrink.volume && (
                            <Text className="text-slate-500 text-[9px] font-bold ml-1.5">
                              (Standard)
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Anzahl / Runde */}
                  <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">
                    Anzahl / Runde
                  </Text>
                  <View className="flex-row items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl p-2 mb-4">
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic("light");
                        setSelectedPortionCount((c) => Math.max(1, c - 1));
                      }}
                      disabled={selectedPortionCount <= 1}
                      className="bg-slate-950 border border-slate-800 p-3 rounded-xl disabled:opacity-30"
                    >
                      <Ionicons name="remove" size={18} color="#cbd5e1" />
                    </TouchableOpacity>

                    <View className="items-center px-4">
                      <Text className="text-white text-lg font-black">{selectedPortionCount}x</Text>
                      <Text className="text-slate-400 text-[10px] font-bold">
                        {((selectedPortionVolume * selectedPortionCount) / 1000).toFixed(2)} l gesamt
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic("light");
                        setSelectedPortionCount((c) => Math.min(10, c + 1));
                      }}
                      disabled={selectedPortionCount >= 10}
                      className="bg-slate-950 border border-slate-800 p-3 rounded-xl disabled:opacity-30"
                    >
                      <Ionicons name="add" size={18} color="#cbd5e1" />
                    </TouchableOpacity>
                  </View>

                  {/* Quick Count Chips */}
                  <View className="flex-row gap-2 mb-5">
                    {[
                      { label: "1x (Nur ich)", count: 1 },
                      { label: "2x", count: 2 },
                      { label: "3x (Runde)", count: 3 },
                      { label: "5x", count: 5 },
                    ].map((chip) => {
                      const isChipActive = selectedPortionCount === chip.count;
                      return (
                        <TouchableOpacity
                          key={`chip-${chip.count}`}
                          onPress={() => {
                            triggerHaptic("light");
                            setSelectedPortionCount(chip.count);
                          }}
                          className={`flex-1 py-2 rounded-xl border items-center ${
                            isChipActive
                              ? "bg-cyan-400/15 border-cyan-400/40"
                              : "bg-slate-900 border-slate-800"
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-black ${
                              isChipActive ? "text-cyan-400" : "text-slate-400"
                            }`}
                          >
                            {chip.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Submit Button */}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleLogWithPortion}
                    className="w-full bg-cyan-400 py-4 rounded-2xl items-center shadow-lg shadow-cyan-500/20 active:scale-95"
                  >
                    <Text className="text-slate-950 font-black text-xs uppercase tracking-wider">
                      {selectedPortionCount}x {portionOptionsDrink.name} eintragen (+{totalEstimatedPoints} XP)
                    </Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* ==========================================
          UNDO-LEISTE (5 Sekunden nach dem Loggen)
          ========================================== */}
      {undoState && (
        <View
          style={{
            position: "absolute",
            bottom: Platform.OS === "web" ? 24 : 16,
            left: 16,
            right: 16,
            zIndex: 9999,
            maxWidth: 600,
            alignSelf: "center",
          }}
          className="bg-slate-900/95 border border-cyan-400/40 rounded-2xl p-3.5 shadow-2xl backdrop-blur-md flex-row items-center justify-between"
        >
          <View className="flex-row items-center flex-1 mr-3">
            <View className="bg-cyan-400/20 p-2 rounded-xl border border-cyan-400/30 mr-2.5">
              <Ionicons name="checkmark" size={16} color="#22d3ee" />
            </View>
            <View className="flex-1">
              <Text className="text-white text-xs font-black" numberOfLines={1}>
                {undoState.drinkName} geloggt
              </Text>
              <Text className="text-cyan-400 text-[10px] font-bold">
                +{undoState.pointsEarned} XP · Läuft in 5 Sek. ab
              </Text>
            </View>
          </View>

          <View className="flex-row items-center">
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleUndo}
              accessibilityLabel="Eintrag rückgängig machen"
              className="bg-amber-400 px-3.5 py-2 rounded-xl flex-row items-center mr-1.5 shadow-md shadow-amber-500/20"
            >
              <Ionicons name="arrow-undo" size={13} color="#020617" />
              <Text className="text-slate-950 text-[11px] font-black uppercase tracking-wider ml-1">
                Rückgängig
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
                setUndoState(null);
              }}
              accessibilityLabel="Schließen"
              className="p-1.5"
            >
              <Ionicons name="close" size={18} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
