import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

// ==========================================
// 1. Interfaces & Types
// ==========================================

export interface UserAchievement {
  id: string;
  unlockedAt: string; // ISO string
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  title: string;
  rank: "Diamant" | "Platin" | "Gold" | "Silber" | "Bronze" | "Unranked";
  points: number;
  alcoholGrams: number;
  achievements: UserAchievement[];
  email?: string;
  password?: string;
  selected_title?: string;
  level?: number;
  active_quest?: string | null;
  currentLevel?: number;
  xpForNextLevel?: number;
  xpProgressInCurrentLevel?: number;
  isLevelLocked?: boolean;
  resetCode?: string | null;
  resetCodeExpiresAt?: string | null;
}


export interface Drink {
  id: string;
  name: string;
  category: "Bier" | "Wein" | "Sekt" | "Schnaps" | "Mischgetränk" | "Alkoholfrei";
  volume: number; // in ml
  abv: number; // in %
  calories: number;
  /** Who added it; null for the built-in catalogue, which nobody may delete. */
  createdBy?: string | null;
  /** EAN-8/EAN-13 barcode, set when someone names a scanned product. */
  ean?: string | null;
}

export interface DrinkLog {
  id: string;
  drinkId: string;
  userId: string;
  eventId?: string;
  timestamp: string; // ISO string
  latitude?: number | null;
  longitude?: number | null;
}

export interface Group {
  id: string;
  name: string;
  adminId: string;
  memberIds: string[];
  pendingUserIds: string[];
}

export interface Event {
  id: string;
  name: string;
  creatorId: string;
  inviteCode: string; // 6-character code
  memberIds: string[];
  endTimestamp: string; // ISO string
}

export interface Post {
  id: string;
  userId: string;
  text: string;
  image?: string;
  // "friends" is a status update broadcast to the author's friends — the
  // contextId is then the author's own user id. It used to be posted as
  // contextType "group" against the legacy id "group-1", which belonged to
  // nobody and only worked because the friends feed filters by author anyway.
  contextType: "group" | "event" | "friends";
  contextId: string;
  timestamp: string; // ISO string
}

export interface BlockedUser {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  timestamp: string;
}

// Kept in sync with REPORT_REASONS in server/index.js.
export type ReportReason = "belaestigung" | "spam" | "unangemessen" | "fake" | "sonstiges";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  belaestigung: "Belästigung oder Mobbing",
  spam: "Spam oder Werbung",
  unangemessen: "Unangemessene Inhalte",
  fake: "Fake-Profil",
  sonstiges: "Etwas anderes",
};

export interface Duel {
  id: string;
  creatorId: string;
  opponentId: string;
  duration: number; // in minutes
  status: "pending" | "active" | "finished";
  startTime: string | null;
  endTime: string | null;
  creatorPoints: number;
  opponentPoints: number;
}

export interface GroupQuest {
  id: string;
  groupId: string;
  title: string;
  type: "drinks" | "volume" | "water";
  targetValue: number;
  currentValue: number;
  status: "active" | "completed" | "failed";
  startTime: string;
  endTime: string;
}

export interface FriendRequest {
  id: string;
  sender_username: string;
  receiver_username: string;
  status: "pending" | "accepted";
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  sender_name?: string;
  sender_avatar?: string | null;
  receiver_id?: string | null;
  group_id?: string | null;
  content: string;
  timestamp: string;
}

// Storage Keys
const KEYS = {
  USERS: "trinkduell_v2_users",
  DRINKS: "trinkduell_v2_drinks",
  LOGS: "trinkduell_v2_logs",
  GROUPS: "trinkduell_v2_groups",
  EVENTS: "trinkduell_v2_events",
  POSTS: "trinkduell_v2_posts",
  CURRENT_USER_ID: "trinkduell_v2_curr_user_id",
  JWT_TOKEN: "trinkduell_v2_jwt_token",
  DUELS: "trinkduell_v2_duels",
  QUESTS: "trinkduell_v2_quests",
  FRIENDS: "trinkduell_v2_friends",
};

// ==========================================
// 2. Calculation Helpers
// ==========================================

// Calculate alcohol in grams: Volume (ml) * (ABV / 100) * Density of Alcohol (0.789)
export const calculateAlcoholGrams = (volumeMl: number, abv: number): number => {
  return volumeMl * (abv / 100) * 0.789;
};

export const getCumulativeXpForLevel = (level: number): number => {
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += Math.floor(Math.pow(l, 1.5) * 100);
  }
  return total;
};

export const getUserProgress = (points: number, level: number) => {
  const currentLevel = level || 1;
  const startXp = getCumulativeXpForLevel(currentLevel);
  const nextXp = Math.floor(Math.pow(currentLevel, 1.5) * 100);
  const endXp = startXp + nextXp;

  const isLocked = points >= endXp;
  const xpProgressInCurrentLevel = isLocked ? (nextXp - 1) : (points - startXp);

  return {
    currentLevel,
    xpForNextLevel: nextXp,
    xpProgressInCurrentLevel: Math.max(0, xpProgressInCurrentLevel),
    isLocked
  };
};

export function enrichUserProgress(user: User): User {
  if (!user) return user;
  const progress = getUserProgress(user.points, user.level || 1);
  return {
    ...user,
    currentLevel: progress.currentLevel,
    xpForNextLevel: progress.xpForNextLevel,
    xpProgressInCurrentLevel: progress.xpProgressInCurrentLevel,
    isLevelLocked: progress.isLocked
  };
}

// ==========================================
// 3. Mock Seeds
// ==========================================
const MOCK_USERS: User[] = [];

const MOCK_DRINKS: Drink[] = [
  { id: "drink-beer-500", name: "Helles Bier", category: "Bier", volume: 500, abv: 5.0, calories: 215 },
  { id: "drink-beer-330", name: "Pils", category: "Bier", volume: 330, abv: 4.9, calories: 140 },
  { id: "drink-shot", name: "Schnaps-Shot", category: "Schnaps", volume: 20, abv: 40.0, calories: 50 },
  { id: "drink-wine-red", name: "Rotwein", category: "Wein", volume: 150, abv: 12.5, calories: 125 },
  { id: "drink-sekt", name: "Sekt", category: "Sekt", volume: 100, abv: 11.5, calories: 85 },
  { id: "drink-aperol", name: "Aperol Spritz", category: "Mischgetränk", volume: 200, abv: 11.0, calories: 180 },
  { id: "drink-cola", name: "Fritz-Kola", category: "Alkoholfrei", volume: 330, abv: 0.0, calories: 139 },
  { id: "drink-sip-beer", name: "Schluck Bier", category: "Bier", volume: 30, abv: 5.0, calories: 13 },
  { id: "drink-sip-wine", name: "Schluck Wein/Sekt", category: "Wein", volume: 20, abv: 12.0, calories: 16 },
  { id: "drink-sip-mix", name: "Schluck Mischgetränk", category: "Mischgetränk", volume: 30, abv: 10.0, calories: 20 },
  { id: "drink-sip-water", name: "Zwischenwasser", category: "Alkoholfrei", volume: 30, abv: 0.0, calories: 0 },
];

const MOCK_GROUPS: Group[] = [];
const MOCK_EVENTS: Event[] = [];
const MOCK_POSTS: Post[] = [];
const MOCK_DUELS: Duel[] = [];
const MOCK_QUESTS: GroupQuest[] = [];

const generateSeedLogs = () => {
  return [];
};

// ==========================================
// 4. AsyncStorage Database Initializer
// ==========================================

let initPromise: Promise<void> | null = null;
let isDbInitialized = false;

const generateUniqueId = (prefix: string): string => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  return `${prefix}-${timestamp}-${random}`;
};

export const initDatabase = async (forceReset = false): Promise<void> => {
  if (isDbInitialized && !forceReset) return;

  if (initPromise && !forceReset) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const isInitialized = await AsyncStorage.getItem(KEYS.USERS);
      if (!isInitialized || forceReset) {
        // Clear old mock catalog data to avoid overlap or partial writes.
        // Deliberately does NOT touch CURRENT_USER_ID/JWT_TOKEN: those
        // belong to the active session, managed by AuthProvider/apiService,
        // not to this local mock catalog. A device that only ever
        // authenticates online never populates KEYS.USERS at all, so this
        // "fresh install?" check used to look true forever and would wipe
        // out a perfectly valid online session the moment any unrelated
        // offline-fallback code path happened to run.
        await AsyncStorage.removeItem(KEYS.USERS);
        await AsyncStorage.removeItem(KEYS.DRINKS);
        await AsyncStorage.removeItem(KEYS.LOGS);
        await AsyncStorage.removeItem(KEYS.GROUPS);
        await AsyncStorage.removeItem(KEYS.EVENTS);
        await AsyncStorage.removeItem(KEYS.POSTS);
        await AsyncStorage.removeItem(KEYS.DUELS);
        await AsyncStorage.removeItem(KEYS.QUESTS);
        await AsyncStorage.removeItem(KEYS.FRIENDS);

        await AsyncStorage.setItem(KEYS.USERS, JSON.stringify([]));
        await AsyncStorage.setItem(KEYS.DRINKS, JSON.stringify(MOCK_DRINKS));
        await AsyncStorage.setItem(KEYS.LOGS, JSON.stringify([]));
        await AsyncStorage.setItem(KEYS.GROUPS, JSON.stringify([]));
        await AsyncStorage.setItem(KEYS.EVENTS, JSON.stringify([]));
        await AsyncStorage.setItem(KEYS.POSTS, JSON.stringify([]));
        await AsyncStorage.setItem(KEYS.DUELS, JSON.stringify([]));
        await AsyncStorage.setItem(KEYS.QUESTS, JSON.stringify([]));
        await AsyncStorage.setItem(KEYS.FRIENDS, JSON.stringify([]));
        
        console.log("Database initialized without fake users.");
      }

      // Ensure friendships is initialized if not present (migration)
      const friendsInitialized = await AsyncStorage.getItem(KEYS.FRIENDS);
      if (!friendsInitialized) {
        await AsyncStorage.setItem(KEYS.FRIENDS, JSON.stringify([]));
      }

      isDbInitialized = true;
    } catch (error) {
      console.error("Failed to initialize local AsyncStorage database:", error);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

// Helper: load raw list from AsyncStorage
async function getRawData<T>(key: string): Promise<T[]> {
  await initDatabase();
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(`Error reading ${key} from storage:`, e);
    return [];
  }
}

// Helper: save raw list to AsyncStorage
async function saveRawData<T>(key: string, data: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Error writing ${key} to storage:`, e);
  }
}

// ==========================================
// 5. Database CRUD APIs
// ==========================================

// Current User ID
export const getCurrentUserId = async (): Promise<string> => {
  await initDatabase();
  return (await AsyncStorage.getItem(KEYS.CURRENT_USER_ID)) || "";
};

// Users
export const getUsers = async (): Promise<User[]> => {
  const list = await getRawData<User>(KEYS.USERS);
  return list.map(enrichUserProgress);
};
export const searchUsers = async (query: string): Promise<User[]> => {
  const users = await getUsers();
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return users.filter(
    (u) =>
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
  );
};
export const updateUser = async (user: User): Promise<void> => {
  const users = await getRawData<User>(KEYS.USERS);
  const updated = users.map((u) => (u.id === user.id ? user : u));
  await saveRawData(KEYS.USERS, updated);
};

// Drinks (Deduplicated on read)
export const getDrinks = async (): Promise<Drink[]> => {
  const list = await getRawData<Drink>(KEYS.DRINKS);
  const requiredSips = [
    { id: "drink-sip-beer", name: "Schluck Bier", category: "Bier", volume: 30, abv: 5.0, calories: 13 },
    { id: "drink-sip-wine", name: "Schluck Wein/Sekt", category: "Wein", volume: 20, abv: 12.0, calories: 16 },
    { id: "drink-sip-mix", name: "Schluck Mischgetränk", category: "Mischgetränk", volume: 30, abv: 10.0, calories: 20 },
  ];
  let needsSave = false;
  for (const sip of requiredSips) {
    if (!list.some((d) => d.id === sip.id)) {
      list.push(sip as Drink);
      needsSave = true;
    }
  }
  if (needsSave) {
    await saveRawData(KEYS.DRINKS, list);
  }

  const seen = new Set<string>();
  return list.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

export const createDrink = async (drink: Omit<Drink, "id">): Promise<Drink> => {
  const drinks = await getDrinks();
  const newDrink: Drink = { ...drink, id: generateUniqueId("drink") };
  drinks.push(newDrink);
  await saveRawData(KEYS.DRINKS, drinks);
  return newDrink;
};

// DrinkLogs (Deduplicated on read)
export const getDrinkLogs = async (): Promise<DrinkLog[]> => {
  const list = await getRawData<DrinkLog>(KEYS.LOGS);
  const seen = new Set<string>();
  return list.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

// Achievements and User stats recalculator
export const recalculateUserStats = async (userId: string): Promise<User> => {
  const users = await getUsers();
  const userIndex = users.findIndex((u) => u.id === userId);
  if (userIndex === -1) throw new Error("User not found");

  const user = users[userIndex];
  const logs = await getDrinkLogs();
  const drinks = await getDrinks();
  const groups = await getRawData<Group>(KEYS.GROUPS);

  // Filter logs for this specific user and sort chronologically (ascending)
  const userLogs = logs
    .filter((l) => l.userId === userId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // 1. Calculate alcohol grams & Party-XP with Kater-Schutz
  let totalAlcohol = 0;
  let beerCount = 0;
  let totalPoints = 0;
  const loggedCategories = new Set<string>();
  const loggedDrinkIds = new Set<string>();
  let hasAlcoholBeforeNoon = false;
  let hasDrinkBetween2and5 = false;

  // Track Kater-Schutz & achievements
  let lastWaterTimestamp: number | null = null;
  let consecutiveWaterCount = 0;
  let maxConsecutiveWaterCount = 0;
  let hasWaterAfter4am = false;

  for (const log of userLogs) {
    const drink = drinks.find((d) => d.id === log.drinkId);
    if (!drink) continue;

    const grams = calculateAlcoholGrams(drink.volume, drink.abv);
    totalAlcohol += grams;
    loggedCategories.add(drink.category);
    loggedDrinkIds.add(drink.id);

    if (drink.category === "Bier") {
      beerCount++;
    }

    // Time calculations
    const logTime = new Date(log.timestamp);
    const hour = logTime.getHours();

    // NACHTEULE: Konsum zwischen 2 und 5 Uhr
    if (hour >= 2 && hour < 5) {
      hasDrinkBetween2and5 = true;
    }

    // FRUEHSCHOPPEN: Alkohol vor 12 Uhr mittags
    if (drink.abv > 0 && hour >= 6 && hour < 12) {
      hasAlcoholBeforeNoon = true;
    }

    // Dual points system & Kater-Schutz
    let basePoints = 0;
    if (drink.abv === 0) {
      // Non-alcoholic
      basePoints = 10;
      totalPoints += basePoints;

      // Track last water timestamp for Kater-Schutz
      lastWaterTimestamp = logTime.getTime();

      // Track consecutive water logs for Hydro-Homie
      consecutiveWaterCount++;
      if (consecutiveWaterCount > maxConsecutiveWaterCount) {
        maxConsecutiveWaterCount = consecutiveWaterCount;
      }

      // Track Überlebenskünstler: water log after 4 AM (4:00 - 8:00 AM)
      if (hour >= 4 && hour < 8) {
        hasWaterAfter4am = true;
      }
    } else {
      // Alcoholic
      basePoints = 10 + Math.round(grams * 2);
      
      // Check if Kater-Schutz multiplier is active (within 30 minutes)
      if (lastWaterTimestamp !== null && (logTime.getTime() - lastWaterTimestamp) <= 30 * 60 * 1000) {
        totalPoints += Math.round(basePoints * 1.25);
        lastWaterTimestamp = null; // Used up!
      } else {
        totalPoints += basePoints;
      }

      // Reset consecutive water logs
      consecutiveWaterCount = 0;
    }
  }

  // 3. Determine Rank (always computed dynamically based on current month's count)
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const monthlyLogsCount = userLogs.filter((log) => {
    const d = new Date(log.timestamp);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).length;

  let rank: User["rank"] = "Unranked";
  if (monthlyLogsCount >= 100) rank = "Diamant";
  else if (monthlyLogsCount >= 75) rank = "Platin";
  else if (monthlyLogsCount >= 50) rank = "Gold";
  else if (monthlyLogsCount >= 25) rank = "Silber";
  else if (monthlyLogsCount >= 10) rank = "Bronze";

  // 4. Achievements check
  const activeAchievements = [...(user.achievements || [])];
  const unlockAchievement = (id: string) => {
    if (!activeAchievements.some((a) => a.id === id)) {
      activeAchievements.push({
        id,
        unlockedAt: new Date().toISOString(),
      });
    }
  };

  const totalDrinksCount = userLogs.length;

  // FIRST_DRINK
  if (totalDrinksCount >= 1) unlockAchievement("FIRST_DRINK");

  // SOMMELIER (>= 3 categories)
  if (loggedCategories.size >= 3) unlockAchievement("SOMMELIER");

  // NACHTEULE
  if (hasDrinkBetween2and5) unlockAchievement("NACHTEULE");

  // BRAUMEISTER (5+ beers)
  if (beerCount >= 5) unlockAchievement("BRAUMEISTER");

  // STAMMGAST (50+ beers)
  if (beerCount >= 50) unlockAchievement("STAMMGAST");

  // FRUEHSCHOPPEN
  if (hasAlcoholBeforeNoon) unlockAchievement("FRUEHSCHOPPEN");

  // SAMMLER (>= 10 unique drinks)
  if (loggedDrinkIds.size >= 10) unlockAchievement("SAMMLER");

  // ANFUEHRER (Admin of a group)
  const isAdmin = groups.some((g) => g.adminId === userId);
  if (isAdmin) unlockAchievement("ANFUEHRER");

  // 3 NEW ACHIEVEMENTS:
  // DRIVER_OF_THE_NIGHT: 0,0g alcohol at the evening (at least 1 drink logged and totalAlcohol === 0)
  if (totalDrinksCount >= 1 && totalAlcohol === 0) {
    unlockAchievement("DRIVER_OF_THE_NIGHT");
  }

  // HYDRO_HOMIE: 3 consecutive water logs
  if (maxConsecutiveWaterCount >= 3) {
    unlockAchievement("HYDRO_HOMIE");
  }

  // UEBERLEBENSKUENSTLER: Water logged after 4:00 AM
  if (hasWaterAfter4am) {
    unlockAchievement("UEBERLEBENSKUENSTLER");
  }

  // Update user object
  user.points = totalPoints;
  user.alcoholGrams = Number(totalAlcohol.toFixed(2));
  user.rank = rank;
  user.achievements = activeAchievements;

  // Level-Up Sperre & Pflichtaufgabe Check
  if (!user.level) user.level = 1;
  const startXp = getCumulativeXpForLevel(user.level);
  const nextXp = Math.floor(Math.pow(user.level, 1.5) * 100);
  const nextLevelThreshold = startXp + nextXp;

  if (user.points >= nextLevelThreshold) {
    user.points = nextLevelThreshold; // XP frieren am Limit des aktuellen Levels ein
    if (!user.active_quest) {
      const quests = [
        "Lade ein Bild mit Freunden hoch",
        "Küsse einen Mitspieler",
        "Trinke ein Zwischenwasser",
        "Finde jemanden, der mit dir anstößt",
        "Trinke ein alkoholfreies Getränk",
        "Mach ein Kompliment an einen Mitspieler"
      ];
      user.active_quest = quests[Math.floor(Math.random() * quests.length)];
    }
  }

  // Automatische Titel nach Level
  const getTitleForLevel = (lvl: number) => {
    if (lvl >= 100) return "Alki";
    if (lvl >= 10) return "Braumeister";
    if (lvl >= 2) return "Trink-Anfänger";
    return "Neuling";
  };

  user.title = getTitleForLevel(user.level);
  user.selected_title = user.title;

  const progress = getUserProgress(user.points, user.level);
  user.currentLevel = progress.currentLevel;
  user.xpForNextLevel = progress.xpForNextLevel;
  user.xpProgressInCurrentLevel = progress.xpProgressInCurrentLevel;
  user.isLevelLocked = progress.isLocked;

  users[userIndex] = user;
  await saveRawData(KEYS.USERS, users);

  return user;
};

// Add DrinkLog
export const addDrinkLog = async (drinkId: string, eventId?: string, latitude?: number | null, longitude?: number | null): Promise<DrinkLog> => {
  const logs = await getDrinkLogs();
  const userId = await getCurrentUserId();
  const newLog: DrinkLog = {
    id: generateUniqueId("log"),
    drinkId,
    userId,
    eventId,
    timestamp: new Date().toISOString(),
    latitude: latitude !== undefined ? latitude : null,
    longitude: longitude !== undefined ? longitude : null,
  };

  logs.push(newLog);
  await saveRawData(KEYS.LOGS, logs);

  // Recalculate stats for the user
  await recalculateUserStats(userId);

  return newLog;
};

// Delete DrinkLog
export const deleteDrinkLog = async (logId: string): Promise<void> => {
  const logs = await getDrinkLogs();
  const logToDelete = logs.find((l) => l.id === logId);
  if (!logToDelete) return;

  const updated = logs.filter((l) => l.id !== logId);
  await saveRawData(KEYS.LOGS, updated);

  // Recalculate stats for the affected user
  await recalculateUserStats(logToDelete.userId);
};

// Groups
export const getGroups = async (): Promise<Group[]> => getRawData<Group>(KEYS.GROUPS);
export const createGroup = async (name: string): Promise<Group> => {
  const groups = await getGroups();
  const userId = await getCurrentUserId();
  const newGroup: Group = {
    id: generateUniqueId("group"),
    name,
    adminId: userId,
    memberIds: [userId],
    pendingUserIds: [],
  };
  groups.push(newGroup);
  await saveRawData(KEYS.GROUPS, groups);
  
  // Recalculate achievements in case ANFUEHRER unlocks
  await recalculateUserStats(userId);
  
  return newGroup;
};

export const joinGroup = async (groupId: string): Promise<void> => {
  const groups = await getGroups();
  const userId = await getCurrentUserId();
  const updated = groups.map((g) => {
    if (g.id === groupId) {
      if (!g.pendingUserIds.includes(userId) && !g.memberIds.includes(userId)) {
        return { ...g, pendingUserIds: [...g.pendingUserIds, userId] };
      }
    }
    return g;
  });
  await saveRawData(KEYS.GROUPS, updated);
};

export const handleJoinRequest = async (groupId: string, targetUserId: string, accept: boolean): Promise<void> => {
  const groups = await getGroups();
  const updated = groups.map((g) => {
    if (g.id === groupId) {
      const pending = g.pendingUserIds.filter((id) => id !== targetUserId);
      const members = accept && !g.memberIds.includes(targetUserId)
        ? [...g.memberIds, targetUserId]
        : g.memberIds;
      return { ...g, pendingUserIds: pending, memberIds: members };
    }
    return g;
  });
  await saveRawData(KEYS.GROUPS, updated);
};

// Events
export const getEvents = async (): Promise<Event[]> => getRawData<Event>(KEYS.EVENTS);
export const createEvent = async (name: string, durationHours: number): Promise<Event> => {
  const events = await getEvents();
  const userId = await getCurrentUserId();
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const newEvent: Event = {
    id: generateUniqueId("event"),
    name,
    creatorId: userId,
    inviteCode,
    memberIds: [userId],
    endTimestamp: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
  };
  events.push(newEvent);
  await saveRawData(KEYS.EVENTS, events);
  return newEvent;
};

export const joinEventWithCode = async (code: string): Promise<Event | null> => {
  const events = await getEvents();
  const userId = await getCurrentUserId();
  const event = events.find((e) => e.inviteCode === code.trim().toUpperCase());
  if (!event) return null;

  if (!event.memberIds.includes(userId)) {
    event.memberIds.push(userId);
    await saveRawData(KEYS.EVENTS, events);
  }
  return event;
};

// Posts
export const getPosts = async (): Promise<Post[]> => getRawData<Post>(KEYS.POSTS);
export const createPost = async (text: string, contextType: Post["contextType"], contextId: string, image?: string, userId?: string): Promise<Post> => {
  const posts = await getPosts();
  const actualUserId = userId || await getCurrentUserId();
  const newPost: Post = {
    id: generateUniqueId("post"),
    userId: actualUserId,
    text,
    image,
    contextType,
    contextId,
    timestamp: new Date().toISOString(),
  };
  posts.push(newPost);
  await saveRawData(KEYS.POSTS, posts);
  return newPost;
};

// Delete Custom Drink and clean up its logs/recalculate user stats
export const deleteDrink = async (drinkId: string): Promise<void> => {
  const drinks = await getDrinks();
  const updated = drinks.filter((d) => d.id !== drinkId);
  await saveRawData(KEYS.DRINKS, updated);

  // Clean up all drink logs referencing this drink
  const logs = await getDrinkLogs();
  const logsToKeep = logs.filter((l) => l.drinkId !== drinkId);
  if (logs.length !== logsToKeep.length) {
    await saveRawData(KEYS.LOGS, logsToKeep);
    
    // Recalculate stats for users who had logs referencing this drink
    const affectedUserIds = Array.from(new Set(logs.filter((l) => l.drinkId === drinkId).map((l) => l.userId)));
    for (const uid of affectedUserIds) {
      await recalculateUserStats(uid);
    }
  }
};

// ==========================================
// 6. Authentication Mock Services
// ==========================================

// Offline password hashing (mirrors the server's bcrypt hashing so a device's
// local AsyncStorage fallback never stores a plaintext password). Uses
// expo-crypto (native/WebCrypto backed) instead of a Node-oriented bcrypt lib,
// which would fail to bundle for React Native via Metro.
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const OFFLINE_HASH_PREFIX = "sha256";

const hashPasswordOffline = async (password: string): Promise<string> => {
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const salt = bytesToHex(saltBytes);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, salt + password);
  return `${OFFLINE_HASH_PREFIX}$${salt}$${digest}`;
};

const verifyPasswordOffline = async (password: string, stored: string | undefined): Promise<boolean> => {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length === 3 && parts[0] === OFFLINE_HASH_PREFIX) {
    const [, salt, expectedDigest] = parts;
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, salt + password);
    return digest === expectedDigest;
  }
  // Legacy plaintext password stored before this fix — compare directly.
  return stored === password;
};

export const mockLogin = async (
  emailOrUsername: string,
  password: string
): Promise<{ user: User; token: string }> => {
  const users = await getUsers();
  const lowercaseInput = emailOrUsername.toLowerCase();

  const matchedUser = users.find(
    (u) => u.email?.toLowerCase() === lowercaseInput || u.name.toLowerCase() === lowercaseInput
  );

  const isValid = matchedUser ? await verifyPasswordOffline(password, matchedUser.password) : false;

  if (!matchedUser || !isValid) {
    throw new Error("Ungültige Anmeldedaten!");
  }

  // Transparently migrate legacy plaintext passwords to the hashed format.
  if (matchedUser.password && !matchedUser.password.startsWith(`${OFFLINE_HASH_PREFIX}$`)) {
    matchedUser.password = await hashPasswordOffline(password);
    await updateUser(matchedUser);
  }

  const token = `mock-jwt-token-${matchedUser.id}`;
  await AsyncStorage.setItem(KEYS.JWT_TOKEN, token);
  await AsyncStorage.setItem(KEYS.CURRENT_USER_ID, matchedUser.id);

  return { user: enrichUserProgress(matchedUser), token };
};

export const mockRegister = async (
  username: string,
  email: string,
  password: string
): Promise<{ user: User; token: string }> => {
  const users = await getUsers();

  if (users.some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
    throw new Error("Ein Account mit dieser E-Mail existiert bereits!");
  }

  const newUserId = generateUniqueId("user");
  const newUser: User = {
    id: newUserId,
    name: username,
    email: email,
    password: await hashPasswordOffline(password),
    avatar: undefined, // No default photo — the UI renders initials instead
    title: "Trink-Anfänger",
    selected_title: "Der Neuling", // Initial start title assignment!
    rank: "Unranked",
    points: 0,
    alcoholGrams: 0,
    achievements: [],
  };

  users.push(newUser);
  await saveRawData(KEYS.USERS, users);
  
  const token = `mock-jwt-token-${newUser.id}`;
  await AsyncStorage.setItem(KEYS.JWT_TOKEN, token);
  await AsyncStorage.setItem(KEYS.CURRENT_USER_ID, newUser.id);
  
  return { user: enrichUserProgress(newUser), token };
};

export const mockForgotPassword = async (
  email: string
): Promise<{ message: string; code: string }> => {
  const users = await getRawData<User>(KEYS.USERS);
  const idx = users.findIndex((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (idx === -1) {
    throw new Error("Kein Benutzer mit dieser E-Mail gefunden!");
  }

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  users[idx].resetCode = code;
  users[idx].resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await saveRawData(KEYS.USERS, users);

  return {
    message: `Reset-Code wurde an ${email} gesendet.`,
    code,
  };
};

export const mockResetPassword = async (
  email: string,
  code: string,
  newPassword: string
): Promise<{ success: boolean }> => {
  if (newPassword.length < 8) {
    throw new Error("Passwort muss mindestens 8 Zeichen lang sein.");
  }

  const users = await getRawData<User>(KEYS.USERS);
  const idx = users.findIndex((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (idx === -1) {
    throw new Error("Kein Benutzer mit dieser E-Mail gefunden!");
  }

  const user = users[idx];
  const isExpired = !user.resetCodeExpiresAt || new Date(user.resetCodeExpiresAt).getTime() < Date.now();
  if (!user.resetCode || user.resetCode !== code.trim() || isExpired) {
    throw new Error("Ungültiger oder abgelaufener Code.");
  }

  user.password = await hashPasswordOffline(newPassword);
  user.resetCode = null;
  user.resetCodeExpiresAt = null;
  users[idx] = user;
  await saveRawData(KEYS.USERS, users);

  return { success: true };
};

export const mockLogout = async (): Promise<void> => {
  await AsyncStorage.removeItem(KEYS.JWT_TOKEN);
};

export const mockGetSession = async (): Promise<{ user: User; token: string } | null> => {
  const token = await AsyncStorage.getItem(KEYS.JWT_TOKEN);
  if (!token) return null;

  const users = await getUsers();
  const userId = token.replace("mock-jwt-token-", "");
  const user = users.find((u) => u.id === userId);

  if (!user) {
    await AsyncStorage.removeItem(KEYS.JWT_TOKEN);
    return null;
  }
  
  return { user: enrichUserProgress(user), token };
};

// ==========================================
// 6. Duels & Quests Mock CRUD APIs
// ==========================================

export const getDuels = async (): Promise<Duel[]> => {
  const duels = await getRawData<Duel>(KEYS.DUELS);
  const logs = await getDrinkLogs();
  const drinks = await getDrinks();
  const now = Date.now();

  let changed = false;
  for (const d of duels) {
    if (d.status === "active") {
      const end = new Date(d.endTime!).getTime();
      if (now > end) {
        d.status = "finished";
        changed = true;
      }
    }

    if (d.status === "active" || d.status === "finished") {
      const p1 = calculateDuelPointsForUser(d.creatorId, d.startTime!, d.endTime!, logs, drinks);
      const p2 = calculateDuelPointsForUser(d.opponentId, d.startTime!, d.endTime!, logs, drinks);
      if (d.creatorPoints !== p1 || d.opponentPoints !== p2) {
        d.creatorPoints = p1;
        d.opponentPoints = p2;
        changed = true;
      }
    }
  }

  if (changed) {
    await saveRawData(KEYS.DUELS, duels);
  }

  return duels;
};

const calculateDuelPointsForUser = (userId: string, startTime: string, endTime: string, logs: DrinkLog[], drinks: Drink[]) => {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  let points = 0;
  for (const log of logs) {
    if (log.userId === userId) {
      const logTime = new Date(log.timestamp).getTime();
      if (logTime >= start && logTime <= end) {
        const drink = drinks.find((d) => d.id === log.drinkId);
        if (drink) {
          const grams = drink.volume * (drink.abv / 100) * 0.789;
          points += 10 + Math.round(grams * 2);
        }
      }
    }
  }
  return points;
};

export const createDuel = async (opponentId: string, duration: number): Promise<Duel> => {
  const duels = await getDuels();
  const userId = await getCurrentUserId();
  const newDuel: Duel = {
    id: generateUniqueId("duel"),
    creatorId: userId,
    opponentId,
    duration,
    status: "pending",
    startTime: null,
    endTime: null,
    creatorPoints: 0,
    opponentPoints: 0,
  };
  duels.push(newDuel);
  await saveRawData(KEYS.DUELS, duels);
  return newDuel;
};

export const acceptDuel = async (duelId: string): Promise<Duel> => {
  const duels = await getDuels();
  const duel = duels.find((d) => d.id === duelId);
  if (!duel) throw new Error("Duell nicht gefunden.");
  
  const start = new Date();
  const end = new Date(start.getTime() + duel.duration * 60 * 1000);

  duel.status = "active";
  duel.startTime = start.toISOString();
  duel.endTime = end.toISOString();

  await saveRawData(KEYS.DUELS, duels);
  return duel;
};

export const getGroupQuests = async (): Promise<GroupQuest[]> => {
  const quests = await getRawData<GroupQuest>(KEYS.QUESTS);
  const groups = await getGroups();
  const logs = await getDrinkLogs();
  const drinks = await getDrinks();
  const now = Date.now();

  let changed = false;
  for (const q of quests) {
    if (q.status === "active") {
      const group = groups.find((g) => g.id === q.groupId);
      if (!group) continue;

      const start = new Date(q.startTime).getTime();
      const end = new Date(q.endTime).getTime();

      let current = 0;
      const memberLogs = logs.filter((l) => group.memberIds.includes(l.userId));

      for (const log of memberLogs) {
        const logTime = new Date(log.timestamp).getTime();
        if (logTime >= start && logTime <= end) {
          const drink = drinks.find((d) => d.id === log.drinkId);
          if (drink) {
            if (q.type === "drinks") {
              current += 1;
            } else if (q.type === "volume") {
              current += drink.volume / 1000;
            } else if (q.type === "water") {
              if (drink.category === "Alkoholfrei" || drink.name.toLowerCase().includes("wasser")) {
                current += 1;
              }
            }
          }
        }
      }

      q.currentValue = Number(current.toFixed(1));

      if (q.currentValue >= q.targetValue) {
        q.status = "completed";
        const posts = await getPosts();
        const postText = `🏆 GEMEINSAM GEWONNEN! Die Gruppe "${group.name}" hat das Ziel "${q.title}" erreicht! (+50 Punkte für alle)`;
        const newPost: Post = {
          id: generateUniqueId("post"),
          userId: "system",
          text: postText,
          contextType: "group",
          contextId: q.groupId,
          timestamp: new Date().toISOString(),
        };
        posts.push(newPost);
        await saveRawData(KEYS.POSTS, posts);
        changed = true;
      } else if (now > end) {
        q.status = "failed";
        changed = true;
      } else {
        changed = true;
      }
    }
  }

  if (changed) {
    await saveRawData(KEYS.QUESTS, quests);
  }

  return quests;
};

export const createGroupQuest = async (
  groupId: string,
  title: string,
  type: "drinks" | "volume" | "water",
  targetValue: number,
  durationHours: number
): Promise<GroupQuest> => {
  const quests = await getGroupQuests();
  const start = new Date();
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

  const newQuest: GroupQuest = {
    id: generateUniqueId("quest"),
    groupId,
    title,
    type,
    targetValue,
    currentValue: 0.0,
    status: "active",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };

  quests.push(newQuest);
  await saveRawData(KEYS.QUESTS, quests);
  return newQuest;
};

export const getFriendships = async (): Promise<FriendRequest[]> => {
  return await getRawData<FriendRequest>(KEYS.FRIENDS);
};

export const sendFriendRequest = async (sender_username: string, receiver_username: string): Promise<void> => {
  const users = await getUsers();
  const receiver = users.find((u) => u.name.toLowerCase() === receiver_username.toLowerCase());
  if (!receiver) {
    throw new Error("Dieser Benutzer existiert nicht.");
  }
  
  const friendships = await getFriendships();
  const exists = friendships.some((f) => 
    (f.sender_username.toLowerCase() === sender_username.toLowerCase() && f.receiver_username.toLowerCase() === receiver_username.toLowerCase()) ||
    (f.sender_username.toLowerCase() === receiver_username.toLowerCase() && f.receiver_username.toLowerCase() === sender_username.toLowerCase())
  );
  if (exists) {
    throw new Error("Es existiert bereits eine Freundschaftsanfrage oder Verbindung.");
  }

  const newRequest: FriendRequest = {
    id: `friendship-${Date.now()}-${Math.random()}`,
    sender_username,
    receiver_username: receiver.name,
    status: "pending",
  };
  friendships.push(newRequest);
  await saveRawData(KEYS.FRIENDS, friendships);
};

export const acceptFriendRequest = async (sender_username: string, receiver_username: string): Promise<void> => {
  const friendships = await getFriendships();
  const req = friendships.find((f) => 
    f.status === "pending" &&
    f.sender_username.toLowerCase() === sender_username.toLowerCase() &&
    f.receiver_username.toLowerCase() === receiver_username.toLowerCase()
  );
  if (!req) {
    throw new Error("Keine ausstehende Anfrage gefunden.");
  }
  req.status = "accepted";
  await saveRawData(KEYS.FRIENDS, friendships);
};

export const getFriends = async (username: string): Promise<{ friends: User[]; pending: User[] }> => {
  const friendships = await getFriendships();
  const users = await getUsers();

  const acceptedFriendNames = friendships
    .filter((f) => f.status === "accepted" && (f.sender_username.toLowerCase() === username.toLowerCase() || f.receiver_username.toLowerCase() === username.toLowerCase()))
    .map((f) => f.sender_username.toLowerCase() === username.toLowerCase() ? f.receiver_username : f.sender_username);

  const friendsList = users.filter((u) => 
    acceptedFriendNames.some((fn) => fn.toLowerCase() === u.name.toLowerCase())
  );

  const pendingIncomingNames = friendships
    .filter((f) => f.status === "pending" && f.receiver_username.toLowerCase() === username.toLowerCase())
    .map((f) => f.sender_username);

  const pendingList = users.filter((u) => 
    pendingIncomingNames.some((pn) => pn.toLowerCase() === u.name.toLowerCase())
  );

  return { friends: friendsList, pending: pendingList };
};

export interface MapCoordinate {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  drinkName: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

export const getMapCoordinates = async (): Promise<MapCoordinate[]> => {
  const logs = await getDrinkLogs();
  const users = await getUsers();
  const drinks = await getDrinks();

  const mapped = logs
    .filter((log) => log.latitude !== undefined && log.latitude !== null && log.longitude !== undefined && log.longitude !== null)
    .slice(-100)
    .map((log) => {
      const user = users.find((u) => u.id === log.userId);
      const drink = drinks.find((d) => d.id === log.drinkId);
      return {
        id: log.id,
        userId: log.userId,
        username: user ? user.name : "Unbekannt",
        avatar: user ? user.avatar || null : null,
        drinkName: drink ? drink.name : "Getränk",
        latitude: Number(log.latitude),
        longitude: Number(log.longitude),
        timestamp: log.timestamp,
      };
    });

  return mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

// ==========================================
// 7. Radar & Feed (offline mirrors of the server-side filtering)
// ==========================================

export type FeedScope = "friends" | "groups";

export interface RadarEntry {
  id: string;
  username: string;
  avatar: string | null;
  level: number;
  status: "active" | "recent" | "idle";
  lastDrinkName: string | null;
  lastActivity: string | null;
}

export interface FeedItem {
  id: string;
  userId: string;
  username: string;
  userAvatar: string | null;
  drink_name?: string;
  volume_ml?: number;
  alcohol_grams?: number;
  is_water?: boolean;
  text?: string;
  /** Beweisfoto zu einem Beitrag (URL im Objektspeicher oder Base64). */
  image?: string | null;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
  type: "log" | "post";
}

// Mirrors server-side resolveFriendUserIds(): friendships are stored by
// username, so they have to be matched back to user ids.
const resolveFriendUserIdsLocal = async (
  username: string,
  includeSelf: boolean
): Promise<Set<string>> => {
  const friendships = await getFriendships();
  const users = await getUsers();
  const me = username.toLowerCase();

  const friendUsernames = new Set<string>();
  friendships.forEach((f) => {
    if (f.status !== "accepted") return;
    const sender = (f.sender_username || "").toLowerCase();
    const receiver = (f.receiver_username || "").toLowerCase();
    if (sender === me) friendUsernames.add(receiver);
    else if (receiver === me) friendUsernames.add(sender);
  });

  const ids = new Set<string>();
  users.forEach((u) => {
    if (friendUsernames.has((u.name || "").toLowerCase())) ids.add(u.id);
    if (includeSelf && (u.name || "").toLowerCase() === me) ids.add(u.id);
  });
  return ids;
};

export const getRadarLocal = async (username: string): Promise<RadarEntry[]> => {
  const friendIds = await resolveFriendUserIdsLocal(username, false);
  const users = await getUsers();
  const logs = await getDrinkLogs();
  const drinks = await getDrinks();

  const now = Date.now();
  const ACTIVE_MS = 30 * 60 * 1000;
  const RECENT_MS = 3 * 60 * 60 * 1000;

  const entries: RadarEntry[] = users
    .filter((u) => friendIds.has(u.id))
    .map((u) => {
      const userLogs = logs.filter((l) => l.userId === u.id);
      let lastLog: DrinkLog | null = null;
      for (const log of userLogs) {
        if (!lastLog || new Date(log.timestamp).getTime() > new Date(lastLog.timestamp).getTime()) {
          lastLog = log;
        }
      }

      const elapsed = lastLog ? now - new Date(lastLog.timestamp).getTime() : null;
      let status: RadarEntry["status"] = "idle";
      if (elapsed !== null && elapsed <= ACTIVE_MS) status = "active";
      else if (elapsed !== null && elapsed <= RECENT_MS) status = "recent";

      const lastDrink = lastLog ? drinks.find((d) => d.id === lastLog!.drinkId) : null;

      return {
        id: u.id,
        username: u.name,
        avatar: u.avatar || null,
        level: u.level || 1,
        status,
        lastDrinkName: lastDrink ? lastDrink.name : null,
        lastActivity: lastLog ? lastLog.timestamp : null,
      };
    });

  const statusRank: Record<RadarEntry["status"], number> = { active: 0, recent: 1, idle: 2 };
  return entries.sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return bTime - aTime;
  });
};

// Who am I allowed to see on the map: confirmed friends + members of my
// groups + myself. Mirrors the server-side check in GET /api/map.
export const resolveMapVisibleUserIds = async (username: string): Promise<Set<string>> => {
  const visible = await resolveFriendUserIdsLocal(username, true);
  const myId = await getCurrentUserId();
  if (myId) visible.add(myId);

  const groups = await getGroups();
  groups
    .filter((g) => (g.memberIds || []).includes(myId))
    .forEach((g) => (g.memberIds || []).forEach((id) => visible.add(id)));

  return visible;
};

export const getMapCoordinatesLocal = async (username: string): Promise<MapCoordinate[]> => {
  const visible = await resolveMapVisibleUserIds(username);
  const all = await getMapCoordinates();
  return all.filter((entry) => visible.has(entry.userId));
};

export const getFeedLocal = async (scope: FeedScope, username: string): Promise<FeedItem[]> => {
  const users = await getUsers();
  const logs = await getDrinkLogs();
  const drinks = await getDrinks();
  const posts = await getPosts();
  const myId = await getCurrentUserId();

  let visibleUserIds: Set<string>;
  let postFilter: (p: Post) => boolean;

  if (scope === "groups") {
    const groups = await getGroups();
    const myGroups = groups.filter((g) => (g.memberIds || []).includes(myId));
    const myGroupIds = new Set(myGroups.map((g) => g.id));

    visibleUserIds = new Set<string>();
    myGroups.forEach((g) => (g.memberIds || []).forEach((id) => visibleUserIds.add(id)));
    postFilter = (p) => p.contextType === "group" && myGroupIds.has(p.contextId);
  } else {
    visibleUserIds = await resolveFriendUserIdsLocal(username, true);
    if (myId) visibleUserIds.add(myId);
    postFilter = (p) => visibleUserIds.has(p.userId) || p.userId === "system";
  }

  const feedLogs: FeedItem[] = logs
    .filter((l) => visibleUserIds.has(l.userId))
    .map((log) => {
      const user = users.find((u) => u.id === log.userId);
      const drink = drinks.find((d) => d.id === log.drinkId);
      return {
        id: log.id,
        userId: log.userId,
        username: user ? user.name : "Unbekannt",
        userAvatar: user ? user.avatar || null : null,
        drink_name: drink ? drink.name : "Getränk",
        volume_ml: drink ? drink.volume : 0,
        alcohol_grams: drink ? Number(calculateAlcoholGrams(drink.volume, drink.abv).toFixed(2)) : 0,
        is_water: drink ? drink.abv === 0 : false,
        latitude: null,
        longitude: null,
        timestamp: log.timestamp,
        type: "log" as const,
      };
    });

  const feedPosts: FeedItem[] = posts.filter(postFilter).map((post) => {
    const user = users.find((u) => u.id === post.userId);
    return {
      id: post.id,
      userId: post.userId,
      username: user ? user.name : post.userId === "system" ? "TrinkDuell" : "System",
      userAvatar: user ? user.avatar || null : null,
      text: post.text,
      // Muss mitkommen, sonst verschwindet das Beweisfoto sobald der Feed aus
      // dem Offline-Fallback kommt (die Regel aus Abschnitt 3.3 der Übergabe:
      // jeder serverseitige Feldsatz braucht sein Gegenstück hier).
      image: post.image || null,
      latitude: null,
      longitude: null,
      timestamp: post.timestamp,
      type: "post" as const,
    };
  });

  return [...feedLogs, ...feedPosts].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
};
