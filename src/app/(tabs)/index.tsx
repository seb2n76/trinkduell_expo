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
import { useFocusEffect } from "expo-router";

import { apiService } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { User, Drink, DrinkLog, calculateAlcoholGrams, getCumulativeXpForLevel } from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";
import { FloatingPointItem, FloatingPointItemType } from "@/components/FloatingPoints";
import { AchievementModal } from "@/components/AchievementModal";
import { useAuth } from "../_layout";
import { getCoordinatesForDrinkLog } from "@/services/location";
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
      const currentUser = await apiService.getCurrentUser();
      const [drinkList, myList, allLogs] = await Promise.all([
        apiService.getDrinks(),
        apiService.getMyDrinks(),
        apiService.getDrinkLogs(),
      ]);

      updateUserContext(currentUser);
      setDrinks(drinkList);
      setMyDrinks(myList);

      const userLogs = allLogs.filter((l) => l.userId === currentUser.id);
      const sortedLogs = userLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setLogs(sortedLogs);
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
    const tab = pickerCategory ? CATEGORY_TABS.find((t) => t.key === pickerCategory) : null;
    const matches = tab ? (tab.matches as readonly string[]) : null;

    // Der Vorfilter gilt nur, solange nicht gesucht wird: wer tippt, sucht im
    // ganzen Katalog — sonst findet man ein Bier nicht, weil gerade der
    // Wein-Reiter offen war.
    const list = query
      ? drinks.filter((d) => d.name.toLowerCase().includes(query))
      : matches
      ? drinks.filter((d) => matches.includes(d.category))
      : drinks;

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
    return drinks
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
    return drinks.filter((d) => matches.includes(d.category)).length;
  }, [drinks, activeCategory]);

  const activeCategoryLabel =
    CATEGORY_TABS.find((t) => t.key === activeCategory)?.plural ?? "Getränke";

  // Extract exactly last 3 logs
  const lastThreeLogs = useMemo(() => {
    return logs.slice(0, 3);
  }, [logs]);

  const handleLogDrink = async (item: { id: string; name: string; volume: number; abv: number; category: Drink["category"] }, pageX?: number, pageY?: number) => {
    const isWater = item.abv === 0;
    const grams = calculateAlcoholGrams(item.volume, item.abv);

    // Only attaches coordinates when the user picked the "auto" location
    // mode; returns null in every other case (manual/off, permission
    // denied, GPS unavailable) so logging never depends on it.
    const coords = await getCoordinatesForDrinkLog();
    const latitude: number | null = coords ? coords.latitude : null;
    const longitude: number | null = coords ? coords.longitude : null;

    let resolvedDrinkId = item.id;

    try {
      // Ensure the drink exists first
      const foundDrink = drinks.find(d => d.id === item.id);
      if (!foundDrink) {
        try {
          const created = await apiService.createDrink({
            name: item.name,
            category: item.category,
            volume: item.volume,
            abv: item.abv,
            calories: isWater ? 0 : Math.round(item.volume * 0.43)
          });
          resolvedDrinkId = created.id;
        } catch (dbErr) {
          console.warn("Could not seed drink database, using default logging format:", dbErr);
        }
      }

      // Optimistic XP bar update on success trigger
      if (user) {
        let pointsEarned = isWater ? 10 : 10 + Math.round(grams * 2);
        if (!isWater && katerSchutz.active) {
          pointsEarned = Math.round(pointsEarned * 1.25);
        }
        updateUserContext({
          ...user,
          points: user.points + pointsEarned,
        });
      }

      // Log the drink using apiService (manages both server POST and offline queue automatically)
      await apiService.addDrinkLog(resolvedDrinkId, undefined, latitude, longitude);

      await triggerHaptic("medium");
      setSuccessBanner(
        isWater
          ? `Erfolgreich geloggt: ${item.name} 💧 Kater-Schutz active!`
          : `Erfolgreich geloggt: ${item.name} (${item.volume}ml) 🍻`
      );
      setTimeout(() => setSuccessBanner(null), 3500);

      const xCoord = pageX || screenWidth / 2;
      const yCoord = pageY || 300;
      let pointsEarned = isWater ? 10 : 10 + Math.round(grams * 2);
      if (!isWater && katerSchutz.active) {
        pointsEarned = Math.round(pointsEarned * 1.25);
      }

      setFloatingPoints((prev) => [
        ...prev,
        { id: `float-${Date.now()}-${Math.random()}`, x: xCoord, y: yCoord, text: `+${pointsEarned} XP` },
      ]);

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

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case "Bier": return "Biere";
      case "Wein": return "Weine";
      case "Mischgetränk": return "Cocktails";
      default: return "Alkoholfrei";
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
                  disabled={editMode}
                  accessibilityLabel={`${item.name} eintragen`}
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
                  accessibilityLabel={`${item.name} eintragen`}
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
    </View>
  );
}
