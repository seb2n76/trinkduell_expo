/* eslint-disable import/no-named-as-default-member */
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, USE_MOCK_ONLY } from "./config";
import * as db from "./mockData";
import { SyncService } from "./sync";
import { Platform } from "react-native";
// Define standard Axios instance
const axiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  // Generous enough for a real deployed path (Netlify/native client -> Cloudflare
  // Tunnel -> home Proxmox server), which routinely sees 200-600ms round trips
  // plus occasional cold-connect spikes. The old 1500ms was tuned for a
  // same-venue festival LAN and was tripping on completely healthy requests.
  timeout: 8000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to automatically insert Bearer token
axiosInstance.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem("trinkduell_v2_jwt_token");
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn("Could not retrieve JWT token for header interceptor:", e);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Called when the server rejects our token. Registered by AuthProvider so the
// api layer can drop the app back to the login screen without importing React.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

// Surface the server's own (German) error text instead of axios' generic
// "Request failed with status code 403". Every screen renders `e.message`
// straight into its error banner, so without this the user only ever sees an
// HTTP status where the backend sent a real explanation.
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const serverMessage = error?.response?.data?.error;
    if (typeof serverMessage === "string" && serverMessage.trim()) {
      error.message = serverMessage;
    }

    // A 401 means the stored token is no longer accepted — expired, account
    // deleted, or every session ended by a password reset. Keeping it would
    // leave the app stuck retrying a dead token on every screen, so drop the
    // session and let the navigation guard send the user to the login screen.
    // /auth/* is excluded: a failed login attempt is not a dead session.
    const url = error?.config?.url || "";
    if (error?.response?.status === 401 && !url.startsWith("/auth/")) {
      clearStoredSession().catch(() => {});
      if (onUnauthorized) onUnauthorized();
    }

    return Promise.reject(error);
  }
);

// True only for "we never got an answer" — no response object means DNS
// failure, timeout, or the server being down. A 4xx/5xx IS an answer.
function isNetworkFailure(error: unknown): boolean {
  return !(error as { response?: unknown })?.response;
}


// Circuit Breaker state to prevent network timeout lags when server is offline.
// Kept short on purpose: this used to be 30s, which meant a single slow
// request would silently push the ENTIRE app (every screen, every device)
// into local-only mode for half a minute — the direct cause of devices
// drifting out of sync with each other and with the server.
let isServerOffline = false;
let lastServerCheckTime = 0;
const SERVER_CHECK_INTERVAL = 5000; // 5 seconds

/** Antwort von GET /groups/:id/members. */
export interface GroupMember {
  id: string;
  name: string;
  avatar?: string | null;
  isAdmin: boolean;
}

export interface GroupMembers {
  members: GroupMember[];
  pending: { id: string; name: string; avatar?: string | null }[];
  adminId: string;
  /** Ob der ABRUFENDE Nutzer Admin ist — spart den Vergleich in jeder Ansicht. */
  isAdmin: boolean;
}

/** Antwort von GET /messages/unread. */
export interface UnreadSummary {
  total: number;
  /** Schlüssel: `dm:<nutzerId>` oder `group:<gruppenId>`. */
  conversations: Record<string, number>;
}

export type ReportStatus = "open" | "resolved" | "dismissed";

/** Eine Meldung, wie die Moderationsansicht sie bekommt. */
export interface ModerationReport {
  id: string;
  reporterName: string;
  reportedName: string;
  contentType: "user" | "post" | "message";
  contentExcerpt?: string | null;
  reason: string;
  details?: string | null;
  status: ReportStatus;
  timestamp: string;
}

export interface ModerationInbox {
  counts: Record<ReportStatus, number>;
  reports: ModerationReport[];
}

export interface AdminSystemStats {
  usersCount: number;
  bannedUsersCount: number;
  drinksCount: number;
  logsCount: number;
  totalVolumeMl: number;
  totalAlcoholGrams: number;
  postsCount: number;
  reportsCount: number;
  openReportsCount: number;
  duelsCount: number;
  activeDuelsCount: number;
}

export interface AdminServerInfo {
  uptimeSeconds: number;
  memoryUsageMb: number;
  nodeVersion: string;
  isPgMode: boolean;
}

export interface AdminDashboardData {
  stats: AdminSystemStats;
  server: AdminServerInfo;
  activeRoomsCount: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email?: string;
  avatar?: string | null;
  points: number;
  level: number;
  rank: string;
  title: string;
  banned: boolean;
  alcoholGrams: number;
  isModerator: boolean;
}

export interface AdminRoom {
  code: string;
  gameId: string;
  status: string;
  playerCount: number;
  hostName: string;
  createdAt: number;
  lastActivity: number;
  currentChapterIndex: number;
}

const JWT_TOKEN_KEY = "trinkduell_v2_jwt_token";
const CACHED_USER_KEY = "trinkduell_v2_cached_user";

// Last-known-good user profile, refreshed on every successful login/session
// check/profile update. Lets getSession() keep a user signed in across a
// reload even if the server can't be reached right that moment, instead of
// treating "network hiccup" the same as "your login expired".
export async function cacheUser(user: db.User): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  } catch (e) {
    console.warn("Failed to cache user for session restore:", e);
  }
}

async function getCachedUser(): Promise<db.User | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function clearStoredSession(): Promise<void> {
  await AsyncStorage.removeItem(JWT_TOKEN_KEY);
  await AsyncStorage.removeItem(CACHED_USER_KEY);
}

/**
 * Executes a network call. If it fails due to connection issues or timeouts,
 * it runs the local database operation instead, enabling offline resilience.
 */
async function executeApiCall<T>(
  networkCall: () => Promise<{ data: T }>,
  localFallback: () => Promise<T>,
  onOffline?: () => void
): Promise<T> {
  // If explicitly configured for local mock only, bypass network call immediately
  if (USE_MOCK_ONLY) {
    if (onOffline) onOffline();
    return await localFallback();
  }

  // If server is known to be offline, bypass network call to avoid UI lag
  const now = Date.now();
  if (isServerOffline && now - lastServerCheckTime < SERVER_CHECK_INTERVAL) {
    if (onOffline) onOffline();
    return await localFallback();
  }

  try {
    const response = await networkCall();
    // Reset circuit breaker on success
    isServerOffline = false;
    return response.data;
  } catch (error) {
    // A server that ANSWERED — 401, 403, 404, 429, 500 — is not offline, and
    // its answer must reach the user. Falling back here used to swallow every
    // rejection: a wrong password or a denied request silently became a local
    // mock result, so the app could show a "successful" login against a
    // phantom offline account and no server-side rule could be relied on.
    if (!isNetworkFailure(error)) {
      throw error;
    }

    // Trip circuit breaker on failure
    isServerOffline = true;
    lastServerCheckTime = now;
    console.warn("Network request failed, falling back to local database:", error);
    if (onOffline) onOffline();
    // Silently fall back to local AsyncStorage database emulator
    return await localFallback();
  }
}

/** Zeitraum, über den die Rangliste rechnet. */
export type ScoreboardPeriod = "all" | "this_month" | "last_month";

/** Zählwerk je Getränkekategorie, wie die Rangliste es aufklappt. */
export interface CategoryTally {
  Bier: number;
  Wein: number;
  Sekt: number;
  Schnaps: number;
  "Mischgetränk": number;
  Alkoholfrei: number;
}

/** Eine Zeile der Rangliste, so wie GET /scoreboard sie liefert. */
export interface ScoreboardRow {
  id: string;
  username: string;
  points: number;
  avatar?: string | null;
  title?: string | null;
  rank?: string | null;
  level: number;
  currentLevel: number;
  xpForNextLevel: number;
  xpProgressInCurrentLevel: number;
  /** Zahlen des abgefragten Zeitraums. */
  periodCount: number;
  periodAlcoholGrams: number;
  periodVolume: number;
  periodCalories: number;
  categoryTally: CategoryTally;
}

const LEERE_KATEGORIEN = (): CategoryTally => ({
  Bier: 0,
  Wein: 0,
  Sekt: 0,
  Schnaps: 0,
  "Mischgetränk": 0,
  Alkoholfrei: 0,
});

/**
 * Grenzen eines Zeitraums, in derselben Auslegung wie auf dem Server:
 * „dieser Monat" ab dem Ersten, „letzter Monat" der Monat davor.
 */
function periodRange(period: ScoreboardPeriod): { since: number | null; until: number | null } {
  const now = new Date();
  if (period === "this_month") {
    return { since: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), until: null };
  }
  if (period === "last_month") {
    return {
      since: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      until: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    };
  }
  return { since: null, until: null };
}

/** Dieselbe Rangliste aus den lokal gespiegelten Daten — für den Offline-Fall. */
async function buildLocalScoreboard(period: ScoreboardPeriod): Promise<ScoreboardRow[]> {
  const [users, logs, drinks] = await Promise.all([
    db.getUsers(),
    db.getDrinkLogs(),
    db.getDrinks(),
  ]);
  const { since, until } = periodRange(period);
  const drinkById = new Map(drinks.map((d) => [d.id, d]));

  return users
    .map((u) => {
      const tally = LEERE_KATEGORIEN();
      let count = 0;
      let alcoholGrams = 0;
      let volume = 0;
      let calories = 0;

      for (const log of logs) {
        if (log.userId !== u.id) continue;
        const t = new Date(log.timestamp).getTime();
        if (since !== null && t < since) continue;
        if (until !== null && t >= until) continue;
        const drink = drinkById.get(log.drinkId);
        if (!drink) continue;
        count += 1;
        alcoholGrams += drink.volume * (drink.abv / 100) * 0.789;
        volume += drink.volume;
        calories += drink.calories || 0;
        if (drink.category in tally) tally[drink.category as keyof CategoryTally] += 1;
      }

      return {
        id: u.id,
        username: u.name,
        points: u.points,
        avatar: u.avatar ?? null,
        title: u.title ?? null,
        rank: u.rank ?? null,
        level: u.level || 1,
        currentLevel: u.currentLevel || u.level || 1,
        xpForNextLevel: u.xpForNextLevel || 0,
        xpProgressInCurrentLevel: u.xpProgressInCurrentLevel || 0,
        periodCount: count,
        periodAlcoholGrams: Number(alcoholGrams.toFixed(2)),
        periodVolume: volume,
        periodCalories: calories,
        categoryTally: tally,
      };
    })
    .sort((a, b) => b.points - a.points);
}

export const apiService = {
  // Users
  getUsers: (): Promise<db.User[]> =>
    executeApiCall(
      () => axiosInstance.get<db.User[]>("/users"),
      () => db.getUsers()
    ),
  
  getCurrentUser: async (): Promise<db.User> => {
    // "Current user id" is an offline-only concept tracked by the local
    // mock (see mockLogin/mockRegister) and is never set for a normal
    // online session — so the online request identifies the caller purely
    // from their JWT via /users/me instead of a locally-tracked id. Using
    // GET /users/${currentId} here used to silently request GET /users/
    // (empty id) for every online session, which Express's non-strict
    // routing quietly matched to the list-all-users endpoint instead of a
    // 404 — the whole user list would come back and get treated as if it
    // were a single user object throughout the app.
    const currentId = await db.getCurrentUserId();
    return executeApiCall(
      () => axiosInstance.get<db.User>("/users/me"),
      async () => {
        const users = await db.getUsers();
        return users.find((u) => u.id === currentId) || users[0];
      }
    );
  },

  updateUser: (user: db.User): Promise<void> =>
    executeApiCall(
      () => axiosInstance.put<void>(`/users/${user.id}`, user),
      () => db.updateUser(user),
      () => SyncService.enqueueSyncJob("UPDATE_USER", { userId: user.id, user })
    ),

  // Drinks
  getDrinks: (): Promise<db.Drink[]> =>
    executeApiCall(
      () => axiosInstance.get<db.Drink[]>("/drinks"),
      () => db.getDrinks()
    ),

  /**
   * Lässt eine kurzlebige Upload-URL signieren. Kein Offline-Fallback: ohne
   * Netz gibt es keinen Upload, und ein lokal behaupteter Erfolg würde ein
   * Bild versprechen, das nirgends liegt.
   */
  requestUploadUrl: async (params: {
    kind: "avatar" | "proof";
    contentType: string;
    contentLength: number;
  }): Promise<{ uploadUrl: string; publicUrl: string; key: string }> => {
    const res = await axiosInstance.post<{ uploadUrl: string; publicUrl: string; key: string }>(
      "/uploads/presign",
      params
    );
    return res.data;
  },

  /**
   * Setzt das Profilbild auf eine URL aus dem eigenen Objektspeicher.
   *
   * Getrennt von uploadAvatar(), das den alten Base64-Weg bedient: eine
   * R2-URL existiert nur, wenn der Upload wirklich geklappt hat, also gibt es
   * hier auch keinen Offline-Fallback. Ein lokal gemerkter Verweis auf ein
   * Objekt, das nie hochgeladen wurde, wäre ein dauerhaft kaputtes Bild.
   */
  setAvatarUrl: async (userId: string, imageUrl: string): Promise<{ avatarUrl: string }> => {
    const res = await axiosInstance.post<{ avatarUrl: string }>(`/users/${userId}/avatar`, {
      image: imageUrl,
    });
    return res.data;
  },

  /** Ob dieser Server Uploads kann — sonst blendet die UI den Button aus. */
  getUploadConfig: async (): Promise<{ enabled: boolean; maxBytes: number }> => {
    try {
      const res = await axiosInstance.get<{ enabled: boolean; maxBytes: number }>(
        "/uploads/config"
      );
      return res.data;
    } catch {
      // Ein älterer Server kennt die Route nicht — dann eben kein Upload.
      return { enabled: false, maxBytes: 0 };
    }
  },

  /**
   * Die persönliche Schnellwahl: die Kacheln auf dem Dashboard.
   *
   * Getrennt von getDrinks(), das den geteilten Katalog liefert. Vorher war
   * beides dasselbe — jedes angelegte Getränk wurde bei allen zur Kachel.
   */
  getMyDrinks: (): Promise<db.Drink[]> =>
    executeApiCall(
      () => axiosInstance.get<db.Drink[]>("/users/me/drinks"),
      // Offline: der zuletzt bekannte Katalog, damit das Dashboard nicht leer
      // ist. Die persönliche Auswahl selbst lebt auf dem Server.
      async () => (await db.getDrinks()).slice(0, 6)
    ),

  setMyDrinks: async (drinkIds: string[]): Promise<db.Drink[]> => {
    const res = await axiosInstance.put<db.Drink[]>("/users/me/drinks", { drinkIds });
    return res.data;
  },

  /**
   * Looks up a scanned barcode. Returns null when the code is unknown — that
   * is the normal path into the community catalogue, not a failure, so the
   * 404 is translated instead of thrown.
   *
   * No offline fallback: the local mock only knows this device's drinks, so a
   * "not found" from it would wrongly send the user into the naming dialog for
   * a product the server already knows.
   */
  lookupDrinkByEan: async (ean: string): Promise<db.Drink | null> => {
    try {
      const res = await axiosInstance.get<db.Drink>(`/drinks/ean/${encodeURIComponent(ean)}`);
      return res.data;
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  createDrink: (drink: Omit<db.Drink, "id">): Promise<db.Drink> =>
    executeApiCall(
      () => axiosInstance.post<db.Drink>("/drinks", drink),
      () => db.createDrink(drink),
      () => SyncService.enqueueSyncJob("CREATE_DRINK", drink)
    ),

  deleteDrink: (drinkId: string): Promise<void> =>
    executeApiCall(
      () => axiosInstance.delete<void>(`/drinks/${drinkId}`),
      () => db.deleteDrink(drinkId),
      () => SyncService.enqueueSyncJob("DELETE_DRINK", { drinkId })
    ),

  // DrinkLogs
  getDrinkLogs: (): Promise<db.DrinkLog[]> =>
    executeApiCall(
      () => axiosInstance.get<db.DrinkLog[]>("/logs"),
      () => db.getDrinkLogs()
    ),

  addDrinkLog: (drinkId: string, eventId?: string, latitude?: number | null, longitude?: number | null): Promise<db.DrinkLog> =>
    executeApiCall(
      async () => {
        const res = await axiosInstance.post<{ success: boolean; log: db.DrinkLog }>("/logs", {
          drinkId,
          eventId,
          latitude,
          longitude,
          lat: latitude,
          lng: longitude
        });
        return { data: res.data.log || (res.data as any) };
      },
      () => db.addDrinkLog(drinkId, eventId, latitude, longitude),
      () => SyncService.enqueueSyncJob("LOG_DRINK", { drinkId, eventId, latitude, longitude, timestamp: new Date().toISOString() })
    ),

  deleteDrinkLog: (logId: string): Promise<void> =>
    executeApiCall(
      () => axiosInstance.delete<void>(`/logs/${logId}`),
      () => db.deleteDrinkLog(logId),
      () => SyncService.enqueueSyncJob("DELETE_DRINK_LOG", { logId })
    ),

  // Groups
  getGroups: (): Promise<db.Group[]> =>
    executeApiCall(
      () => axiosInstance.get<db.Group[]>("/groups"),
      () => db.getGroups()
    ),

  createGroup: (name: string, memberIds?: string[]): Promise<db.Group> =>
    executeApiCall(
      () => axiosInstance.post<db.Group>("/groups", { name, memberIds }),
      () => db.createGroup(name)
    ),

  joinGroup: (groupId: string): Promise<void> =>
    executeApiCall(
      () => axiosInstance.post<void>(`/groups/${groupId}/join`),
      () => db.joinGroup(groupId),
      () => SyncService.enqueueSyncJob("JOIN_GROUP", { groupId })
    ),

  handleJoinRequest: (groupId: string, targetUserId: string, accept: boolean): Promise<void> =>
    executeApiCall(
      () => axiosInstance.post<void>(`/groups/${groupId}/requests`, { targetUserId, accept }),
      () => db.handleJoinRequest(groupId, targetUserId, accept)
    ),


  /**
   * Mitglieder einer Gruppe. Bewusst ohne Offline-Fallback: die lokale
   * Mock-DB kennt weder Adminrolle noch offene Anfragen, und eine erfundene
   * Mitgliederliste wäre schlimmer als eine ehrliche Fehlermeldung.
   */
  getGroupMembers: async (groupId: string): Promise<GroupMembers> => {
    const res = await axiosInstance.get<GroupMembers>(`/groups/${groupId}/members`);
    return res.data;
  },

  addGroupMember: async (groupId: string, userId: string): Promise<db.Group> => {
    const res = await axiosInstance.post<db.Group>(`/groups/${groupId}/members`, { userId });
    return res.data;
  },

  /**
   * Entfernt jemanden. Die eigene ID einzusetzen heißt „Gruppe verlassen".
   *
   * `groupDeleted` meldet, dass man das letzte Mitglied war und die Gruppe
   * damit aufgelöst wurde; `adminId` nennt den (womöglich neuen) Admin.
   */
  removeGroupMember: async (
    groupId: string,
    userId: string
  ): Promise<{ groupDeleted: boolean; adminId?: string }> => {
    const res = await axiosInstance.delete<{ groupDeleted: boolean; adminId?: string }>(
      `/groups/${groupId}/members/${userId}`
    );
    return res.data;
  },

  /** Einladungscode der Gruppe. Nur der Admin darf — sonst 403. */
  getGroupInvite: async (groupId: string): Promise<string> => {
    const res = await axiosInstance.get<{ inviteCode: string }>(`/groups/${groupId}/invite`);
    return res.data.inviteCode;
  },

  /**
   * Vergibt einen neuen Code und entwertet den alten.
   *
   * Gehört nach jedem Rauswurf gemacht: ohne Rotation träte ein Entferntes
   * Mitglied mit dem alten Code einfach wieder bei.
   */
  rotateGroupInvite: async (groupId: string): Promise<string> => {
    const res = await axiosInstance.post<{ inviteCode: string }>(`/groups/${groupId}/invite/rotate`);
    return res.data.inviteCode;
  },

  /** Beitritt per Code — ohne Offline-Fallback, die Mitgliedschaft liegt am Server. */
  joinGroupByCode: async (code: string): Promise<db.Group> => {
    const res = await axiosInstance.post<db.Group>("/groups/join", { code });
    return res.data;
  },

  /**
   * Ungelesen-Zahlen für alle Unterhaltungen.
   *
   * Ohne Offline-Fallback: die lokale Mock-DB kennt keine Lesestände, und eine
   * erfundene Zahl wäre schlimmer als keine. Bei einem Netzfehler bleibt die
   * bisherige Anzeige stehen (siehe refresh in components/UnreadProvider).
   */
  getUnreadMessages: async (): Promise<UnreadSummary> => {
    const res = await axiosInstance.get<UnreadSummary>("/messages/unread");
    return res.data;
  },

  markConversationRead: async (ziel: { receiverId?: string; groupId?: string }): Promise<void> => {
    await axiosInstance.post("/messages/read", ziel);
  },

  /**
   * Meldungen für die Moderationsansicht.
   *
   * Ohne Offline-Fallback und ohne Fehlerunterdrückung: wer moderiert, muss
   * merken, wenn die Liste nicht kommt. Antwortet mit 404, wenn der Aufrufer
   * kein Moderator ist (siehe ADMIN_USER_IDS auf dem Server).
   */
  getReports: async (status?: ReportStatus): Promise<ModerationInbox> => {
    const res = await axiosInstance.get<ModerationInbox>(
      status ? `/reports?status=${status}` : "/reports"
    );
    return res.data;
  },

  setReportStatus: async (id: string, status: ReportStatus): Promise<void> => {
    await axiosInstance.patch(`/reports/${id}`, { status });
  },

  // Events
  getEvents: (): Promise<db.Event[]> =>
    executeApiCall(
      () => axiosInstance.get<db.Event[]>("/events"),
      () => db.getEvents()
    ),

  createEvent: (name: string, durationHours: number): Promise<db.Event> =>
    executeApiCall(
      () => axiosInstance.post<db.Event>("/events", { name, durationHours }),
      () => db.createEvent(name, durationHours)
    ),

  joinEventWithCode: (code: string): Promise<db.Event | null> =>
    executeApiCall(
      () => axiosInstance.post<db.Event | null>("/events/join", { code }),
      () => db.joinEventWithCode(code)
    ),

  // Posts
  getPosts: (): Promise<db.Post[]> =>
    executeApiCall(
      () => axiosInstance.get<db.Post[]>("/posts"),
      () => db.getPosts()
    ),

  createPost: (text: string, contextType: db.Post["contextType"], contextId: string, image?: string): Promise<db.Post> =>
    executeApiCall(
      () => axiosInstance.post<db.Post>("/posts", { text, contextType, contextId, image }),
      () => db.createPost(text, contextType, contextId, image),
      () => SyncService.enqueueSyncJob("CREATE_POST", { text, contextType, contextId, image })
    ),

  /**
   * Löscht einen eigenen Beitrag samt Bild.
   *
   * Kein Offline-Fallback: ein lokal als gelöscht markierter Beitrag, der
   * serverseitig weiterlebt, wäre die gefährlichere Variante — der Nutzer
   * glaubt, sein Foto sei weg, und es steht weiter im Feed seiner Freunde.
   */
  deletePost: async (postId: string): Promise<void> => {
    await axiosInstance.delete<void>(`/posts/${postId}`);
  },

  // Auth Operations
  login: async (emailOrUsername: string, password: string): Promise<{ user: db.User; token: string }> => {
    const res = await executeApiCall(
      () => axiosInstance.post<{ user: db.User; token: string }>("/auth/login", { emailOrUsername, password }),
      () => db.mockLogin(emailOrUsername, password)
    );
    await cacheUser(res.user);
    return res;
  },

  register: async (username: string, email: string, password: string): Promise<{ user: db.User; token: string }> => {
    const res = await executeApiCall(
      () => axiosInstance.post<{ user: db.User; token: string }>("/auth/register", { username, email, password }),
      () => db.mockRegister(username, email, password),
      // Queues the ORIGINAL plaintext password (not db.mockRegister's
      // salted-offline-hash) so the eventual sync hits the real
      // /auth/register endpoint exactly like an online signup would.
      () => SyncService.enqueueSyncJob("CREATE_USER", { username, email, password })
    );
    await cacheUser(res.user);
    return res;
  },

  logout: async (): Promise<void> => {
    await executeApiCall(
      () => axiosInstance.post<void>("/auth/logout"),
      () => db.mockLogout()
    );
    await clearStoredSession();
  },

  // Deliberately bypasses executeApiCall's offline fallback: deleting an
  // account only locally while the real server-side account (and its data)
  // survives would be misleading, so this requires an actual connection and
  // throws if the server can't be reached instead of silently "succeeding".
  deleteAccount: async (userId: string): Promise<void> => {
    await axiosInstance.delete<void>(`/users/${userId}`);
  },

  // Both password-reset calls deliberately bypass the offline fallback, for
  // the same reason deleteAccount does: the password that matters lives on
  // the server. "Resetting" it against the local mock would report success
  // and then leave the user unable to log in anywhere.
  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const res = await axiosInstance.post<{ message: string }>("/auth/forgot-password", { email });
    return res.data;
  },

  resetPassword: async (email: string, code: string, newPassword: string): Promise<{ success: boolean }> => {
    const res = await axiosInstance.post<{ success: boolean }>("/auth/reset-password", {
      email,
      code,
      newPassword,
    });
    return res.data;
  },

  // Ebenfalls ohne Offline-Fallback, und der zurückgegebene Token ist nicht
  // optional: die Änderung beendet serverseitig alle Sitzungen, auch die
  // eigene. Wer den neuen Token nicht speichert, fliegt beim nächsten Request
  // raus.
  changePassword: async (
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; token: string }> => {
    const res = await axiosInstance.post<{ success: boolean; token: string }>(
      "/auth/change-password",
      { currentPassword, newPassword }
    );
    return res.data;
  },

  // Deliberately doesn't use executeApiCall's generic offline fallback:
  // db.mockGetSession() only understands locally-issued "mock-jwt-token-*"
  // strings, so for a real server-issued JWT it would find no match and —
  // worse — delete the perfectly valid token. A network hiccup during a
  // page reload must not force a real login out from under the user.
  getSession: async (): Promise<{ user: db.User; token: string } | null> => {
    const token = await AsyncStorage.getItem(JWT_TOKEN_KEY);
    if (!token) return null;

    if (USE_MOCK_ONLY) {
      return db.mockGetSession();
    }

    try {
      const res = await axiosInstance.get<{ user: db.User; token: string }>("/auth/session");
      await cacheUser(res.data.user);
      return res.data;
    } catch (error: any) {
      if (error?.response?.status === 401) {
        // Server explicitly rejected the token (expired/deleted account) —
        // a real logout, not a connectivity issue.
        await clearStoredSession();
        return null;
      }

      console.warn("Could not verify session with server, using cached session:", error);
      const cachedUser = await getCachedUser();
      if (cachedUser) {
        return { user: cachedUser, token };
      }

      // Locally-issued mock tokens can still be resolved offline. A real
      // server-issued JWT must NOT be handed to mockGetSession(): it can't
      // match one against the local mock user list and would delete the
      // still-valid token as a side effect, logging the user out for good.
      if (token.startsWith("mock-jwt-token-")) {
        return db.mockGetSession();
      }

      // Real token, server unreachable, no cached profile yet: keep the
      // session and let the caller retry once connectivity returns.
      return null;
    }
  },

  uploadAvatar: (userId: string, imageUri: string, base64Data?: string): Promise<{ avatarUrl: string }> =>
    executeApiCall(
      async () => {
        if (base64Data) {
          const res = await axiosInstance.post<{ avatarUrl: string }>(`/users/${userId}/avatar`, {
            image: `data:image/jpeg;base64,${base64Data}`
          });
          return res;
        } else {
          const formData = new FormData();
          const uriParts = imageUri.split('.');
          const fileType = uriParts[uriParts.length - 1];
          formData.append("avatar", {
            uri: imageUri,
            name: `photo.${fileType}`,
            type: `image/${fileType}`,
          } as any);
          const res = await axiosInstance.post<{ avatarUrl: string }>(`/users/${userId}/avatar`, formData, {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          });
          return res;
        }
      },
      async () => {
        const users = await db.getUsers();
        const user = users.find((u) => u.id === userId);
        let savedUrl = base64Data ? `data:image/jpeg;base64,${base64Data}` : imageUri;

        // If on Web and we have base64Data, compress it to avoid AsyncStorage/LocalStorage QuotaExceededError
        if (Platform.OS === "web" && base64Data && typeof document !== "undefined") {
          try {
            savedUrl = await new Promise<string>((resolve) => {
              const img = new window.Image();
              img.src = `data:image/jpeg;base64,${base64Data}`;
              img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = 120;
                canvas.height = 120;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.drawImage(img, 0, 0, 120, 120);
                  const dataUrl = canvas.toDataURL("image/jpeg", 0.6); // 60% quality is perfect for 120x120 avatar
                  resolve(dataUrl);
                } else {
                  resolve(`data:image/jpeg;base64,${base64Data}`);
                }
              };
              img.onerror = () => {
                resolve(`data:image/jpeg;base64,${base64Data}`);
              };
            });
          } catch (compressErr) {
            console.warn("Avatar compression failed, using original:", compressErr);
          }
        }

        // On web a blob: URL is only valid for the current page load, so
        // persisting it would show a broken image after the next reload —
        // which looked like the profile picture had vanished.
        const isEphemeralUri = savedUrl.startsWith("blob:");
        if (user && !isEphemeralUri) {
          user.avatar = savedUrl;
          await db.updateUser(user);
        }
        return { avatarUrl: isEphemeralUri ? user?.avatar || "" : savedUrl };
      },
      () => {
        // Only queue a self-contained data URL. A blob:/file: URI is local to
        // this device (and on web dies on the next reload), so syncing one
        // would store a permanently broken image reference server-side.
        if (!base64Data) return;
        SyncService.enqueueSyncJob("UPDATE_USER", {
          userId,
          user: {
            id: userId,
            avatar: `data:image/jpeg;base64,${base64Data}`,
          },
        });
      }
    ),

  // Duels
  getDuels: (): Promise<db.Duel[]> =>
    executeApiCall(
      () => axiosInstance.get<db.Duel[]>("/duels"),
      () => db.getDuels()
    ),

  createDuel: (opponentId: string, duration: number): Promise<db.Duel> =>
    executeApiCall(
      () => axiosInstance.post<db.Duel>("/duels", { opponentId, duration }),
      () => db.createDuel(opponentId, duration)
    ),

  acceptDuel: (duelId: string): Promise<db.Duel> =>
    executeApiCall(
      () => axiosInstance.post<db.Duel>(`/duels/${duelId}/accept`),
      () => db.acceptDuel(duelId)
    ),

  // Group Quests
  getGroupQuests: (): Promise<db.GroupQuest[]> =>
    executeApiCall(
      () => axiosInstance.get<db.GroupQuest[]>("/quests"),
      () => db.getGroupQuests()
    ),

  createGroupQuest: (
    groupId: string,
    title: string,
    type: "drinks" | "volume" | "water",
    targetValue: number,
    durationHours: number
  ): Promise<db.GroupQuest> =>
    executeApiCall(
      () => axiosInstance.post<db.GroupQuest>("/quests", { groupId, title, type, targetValue, durationHours }),
      () => db.createGroupQuest(groupId, title, type, targetValue, durationHours)
    ),

  // Multi-Device Game Rooms & Story-RPG
  //
  // Ausweis ist der playerToken, den der Server beim Erstellen bzw. Beitreten
  // einmalig ausliefert — nicht die playerId. Die steht in jeder Raumantwort
  // und ist damit allen Mitspielern bekannt.
  createGameRoom: async (gameId: string, hostName: string, hostAvatar?: string | null): Promise<{ success: boolean; code: string; hostId: string; playerToken: string; room: any }> => {
    const res = await axiosInstance.post<{ success: boolean; code: string; hostId: string; playerToken: string; room: any }>("/game-rooms", {
      gameId,
      hostName,
      hostAvatar,
    });
    return res.data;
  },

  /** `playerToken` nur beim Wiedereintritt setzen; neue Spieler bekommen einen neuen. */
  joinGameRoom: async (code: string, playerName: string, playerAvatar?: string | null, playerToken?: string): Promise<{ success: boolean; code: string; playerId: string; playerToken: string; room: any }> => {
    const res = await axiosInstance.post<{ success: boolean; code: string; playerId: string; playerToken: string; room: any }>(`/game-rooms/${code}/join`, {
      playerName,
      playerAvatar,
      playerToken,
    });
    return res.data;
  },

  getGameRoom: async (code: string, playerToken?: string): Promise<{ success: boolean; room: any }> => {
    const params = playerToken ? `?playerToken=${encodeURIComponent(playerToken)}` : "";
    const res = await axiosInstance.get<{ success: boolean; room: any }>(`/game-rooms/${code}${params}`);
    return res.data;
  },

  startGameRoom: async (code: string, playerToken: string, gameSetupData: any): Promise<{ success: boolean; room: any }> => {
    const res = await axiosInstance.post<{ success: boolean; room: any }>(`/game-rooms/${code}/start`, {
      playerToken,
      gameSetupData,
    });
    return res.data;
  },

  submitGameRoomAction: async (code: string, playerToken: string, actionType: string, payload: any): Promise<{ success: boolean; room: any }> => {
    const res = await axiosInstance.post<{ success: boolean; room: any }>(`/game-rooms/${code}/action`, {
      playerToken,
      actionType,
      payload,
    });
    return res.data;
  },

  /**
   * Schreibt die Punkte einer beendeten Runde dem angemeldeten Konto gut.
   *
   * Braucht beides: das JWT (steckt der Interceptor dazu) und den Raum-Token
   * als Nachweis, wirklich mitgespielt zu haben. Der Server zahlt pro Runde
   * nur einmal aus — ein zweiter Aufruf antwortet mit `awarded: false` und
   * ist kein Fehler.
   */
  claimGameRoomPoints: async (code: string, playerToken: string): Promise<{ success: boolean; awarded: boolean; points: number; reason?: string }> => {
    const res = await axiosInstance.post<{ success: boolean; awarded: boolean; points: number; reason?: string }>(
      `/game-rooms/${code}/claim`,
      { playerToken }
    );
    return res.data;
  },

  nextGameRoomChapter: async (code: string, playerToken: string, params: { nextStatus?: string; nextChapterData?: any; outcomeSummary?: string }): Promise<{ success: boolean; room: any }> => {
    const res = await axiosInstance.post<{ success: boolean; room: any }>(`/game-rooms/${code}/next`, {
      playerToken,
      ...params,
    });
    return res.data;
  },

  leaveGameRoom: async (code: string, playerToken: string): Promise<{ success: boolean }> => {
    const res = await axiosInstance.post<{ success: boolean }>(`/game-rooms/${code}/leave`, {
      playerToken,
    });
    return res.data;
  },

  levelUp: (): Promise<db.User> =>
    executeApiCall(
      () => axiosInstance.post<db.User>("/users/level-up").then(res => res),
      async () => {
        const currentId = await db.getCurrentUserId();
        const users = await db.getUsers();
        const user = users.find((u) => u.id === currentId);
        if (user) {
          user.level = (user.level || 1) + 1;
          user.active_quest = null;
          
          // Title calculation
          const getTitleForLevel = (lvl: number) => {
            if (lvl >= 100) return "Alki";
            if (lvl >= 10) return "Braumeister";
            if (lvl >= 2) return "Trink-Anfänger";
            return "Neuling";
          };
          user.title = getTitleForLevel(user.level);
          user.selected_title = user.title;
          
          // Save and recalculate
          await db.updateUser(user);
          await db.recalculateUserStats(user.id);
          
          // Create local post for social feed
          await db.createPost(
            `⭐ LEVEL UP! ${user.name} hat Level ${user.level} erreicht! (${user.title})`,
            "group",
            "group-1",
            undefined,
            "system"
          );

          // Reload user
          const refreshedUsers = await db.getUsers();
          return refreshedUsers.find((u) => u.id === currentId) || user;
        }
        throw new Error("Local user not found");
      }
    ),

  sendFriendRequest: (sender_username: string, receiver_username: string): Promise<void> =>
    executeApiCall(
      () => axiosInstance.post<void>("/friends/request", { sender_username, receiver_username }),
      () => db.sendFriendRequest(sender_username, receiver_username)
    ),

  acceptFriendRequest: (sender_username: string, receiver_username: string): Promise<void> =>
    executeApiCall(
      () => axiosInstance.post<void>("/friends/accept", { sender_username, receiver_username }),
      () => db.acceptFriendRequest(sender_username, receiver_username)
    ),

  // Removing a friend and blocking both change who may see the user's feed,
  // radar and location. That decision only counts if the server made it, so
  // these deliberately have no offline fallback — a local-only "removed" would
  // leave the real access in place while the UI claims otherwise.
  removeFriend: async (username: string): Promise<void> => {
    await axiosInstance.delete<void>(`/friends/${encodeURIComponent(username)}`);
  },

  getBlockedUsers: async (): Promise<db.BlockedUser[]> => {
    const res = await axiosInstance.get<db.BlockedUser[]>("/blocks");
    return res.data;
  },

  blockUser: async (userId: string): Promise<void> => {
    await axiosInstance.post<void>("/blocks", { userId });
  },

  unblockUser: async (userId: string): Promise<void> => {
    await axiosInstance.delete<void>(`/blocks/${userId}`);
  },

  reportContent: async (report: {
    reportedUserId: string;
    contentType: "user" | "post" | "message";
    contentId?: string;
    reason: db.ReportReason;
    details?: string;
  }): Promise<void> => {
    await axiosInstance.post<void>("/reports", report);
  },

  getFriends: (username: string): Promise<{ friends: db.User[]; pending: db.User[] }> =>
    executeApiCall(
      async () => {
        const res = await axiosInstance.get<any>(`/friends/${username}`);
        if (Array.isArray(res.data)) {
          return { data: { friends: res.data, pending: [] } };
        }
        return {
          data: {
            friends: res.data.friends || [],
            pending: res.data.pending || [],
          },
        };
      },
      () => db.getFriends(username)
    ),

  getRadar: (username: string): Promise<db.RadarEntry[]> =>
    executeApiCall(
      () => axiosInstance.get<db.RadarEntry[]>("/radar"),
      () => db.getRadarLocal(username)
    ),

  /**
   * Feed laden.
   *
   * `groupId` grenzt den Gruppen-Feed auf eine einzelne Gruppe ein. Ohne
   * Angabe kommen alle eigenen Gruppen zusammen — was bei mehr als einer
   * Gruppe unübersichtlich wird und der Grund für den Filter war.
   */
  getFeed: (
    scope: db.FeedScope,
    username: string,
    groupId?: string | null,
    /** `before` ist der Zeitstempel des ältesten bereits geladenen Eintrags. */
    page?: { limit?: number; before?: string | null }
  ): Promise<db.FeedItem[]> => {
    const params = new URLSearchParams({ scope });
    if (groupId) params.set("groupId", groupId);
    if (page?.limit) params.set("limit", String(page.limit));
    if (page?.before) params.set("before", page.before);
    return executeApiCall(
      () => axiosInstance.get<db.FeedItem[]>(`/feed?${params.toString()}`),
      () => db.getFeedLocal(scope, username)
    );
  },

  /**
   * Die Rangliste — samt der Zahlen des gewählten Zeitraums.
   *
   * Diese Zahlen hat der Client bis zum 21.08.2026 selbst gerechnet und dafür
   * über `/logs` sämtliche Einträge sämtlicher Konten geholt. Das war nicht
   * nur teuer, es war auch der Weg, auf dem fremde Trinkhistorien im Gerät
   * jedes Beliebigen landeten. Jetzt kommt die fertige Summe.
   *
   * Der Offline-Rückfall rechnet dasselbe aus den lokal gespiegelten Daten —
   * dort liegen ohnehin nur die eigenen.
   */
  getScoreboard: (period: ScoreboardPeriod = "all"): Promise<ScoreboardRow[]> =>
    executeApiCall(
      async () => {
        const res = await axiosInstance.get<{ rows: ScoreboardRow[] }>(
          `/scoreboard?period=${period}`
        );
        return { data: res.data?.rows ?? [] };
      },
      () => buildLocalScoreboard(period)
    ),

  toggleReaction: (
    targetId: string,
    emoji: "cheers" | "fire" | "water",
    userId?: string
  ): Promise<{ success: boolean; reactions: { cheers: string[]; fire: string[]; water: string[] } }> =>
    executeApiCall(
      () =>
        axiosInstance.post<{ success: boolean; reactions: { cheers: string[]; fire: string[]; water: string[] } }>(
          `/feed/${targetId}/react`,
          { emoji }
        ),
      async () => {
        const reactions = await db.toggleReactionLocal(targetId, userId || "mock-user", emoji);
        return { success: true, reactions };
      }
    ),

  getMap: (username: string): Promise<db.MapCoordinate[]> =>
    executeApiCall(
      () => axiosInstance.get<db.MapCoordinate[]>("/map"),
      () => db.getMapCoordinatesLocal(username)
    ),

  searchUsers: (query: string): Promise<db.User[]> =>
    executeApiCall(
      () => axiosInstance.get<db.User[]>(`/users/search?q=${encodeURIComponent(query)}`),
      () => db.searchUsers(query)
    ),

  /**
   * Ein Direktchat. Der Server liefert die neuesten `limit` Nachrichten in
   * aufsteigender Reihenfolge; `before` holt das Stück davor.
   */
  getDirectMessages: (
    otherUserId: string,
    page?: { limit?: number; before?: string | null }
  ): Promise<db.DirectMessage[]> => {
    const params = new URLSearchParams();
    if (page?.limit) params.set("limit", String(page.limit));
    if (page?.before) params.set("before", page.before);
    const query = params.toString();
    return executeApiCall(
      () =>
        axiosInstance.get<db.DirectMessage[]>(
          `/messages/direct/${otherUserId}${query ? `?${query}` : ""}`
        ),
      () => Promise.resolve([])
    );
  },

  /** Wie getDirectMessages, nur für einen Gruppenchat. */
  getGroupMessages: (
    groupId: string,
    page?: { limit?: number; before?: string | null }
  ): Promise<db.DirectMessage[]> => {
    const params = new URLSearchParams();
    if (page?.limit) params.set("limit", String(page.limit));
    if (page?.before) params.set("before", page.before);
    const query = params.toString();
    return executeApiCall(
      () =>
        axiosInstance.get<db.DirectMessage[]>(
          `/messages/group/${groupId}${query ? `?${query}` : ""}`
        ),
      () => Promise.resolve([])
    );
  },

  sendMessage: (data: { receiverId?: string; groupId?: string; content: string }): Promise<db.DirectMessage> =>
    executeApiCall(
      () => axiosInstance.post<db.DirectMessage>("/messages", data),
      () => Promise.resolve({
        id: `msg-${Date.now()}`,
        sender_id: "me",
        receiver_id: data.receiverId || null,
        group_id: data.groupId || null,
        content: data.content,
        timestamp: new Date().toISOString()
      })
    ),

  // No offline fallback: a push token is only meaningful once the server
  // can reach it, so there's nothing useful to queue while offline — the
  // caller just retries on the next app start.
  registerPushToken: async (token: string): Promise<void> => {
    await axiosInstance.post<void>("/users/push-token", { token });
  },

  // ─── Admin Console Endpoints ───────────────────────────────────────────────
  //
  // Bewusst OHNE Offline-Rückfall — aus demselben Grund wie bei
  // deleteAccount und den Passwort-Routen: Diese Ansicht existiert, um
  // SERVERzustand zu zeigen und zu ändern. Ein lokaler Ersatz beantwortet
  // genau die Fragen falsch, für die man sie öffnet.
  //
  // Was der Rückfall tat, bevor er hier verschwand:
  //   - "Nutzer gesperrt" meldete Erfolg, ohne irgendwo etwas zu sperren.
  //     Ein Moderator hätte einen Missbrauchsfall für erledigt gehalten,
  //     während der Account weiterlief.
  //   - Das Dashboard zeigte erfundene Serverwerte (Laufzeit 3600 s,
  //     42 MB Speicher) und feste Nullen für offene Meldungen — lesbar als
  //     "alles ruhig", obwohl der Server gar nicht erreichbar war.
  //
  // Der Screen fängt den Fehler ab und zeigt ihn an; eine ehrliche
  // Fehlermeldung ist hier mehr wert als eine Zahl, die niemand nachprüft.
  getAdminStats: async (): Promise<AdminDashboardData> => {
    const res = await axiosInstance.get<AdminDashboardData>("/admin/stats");
    return res.data;
  },

  getAdminUsers: async (params?: { q?: string; filter?: string }): Promise<AdminUser[]> => {
    const query = new URLSearchParams();
    if (params?.q) query.append("q", params.q);
    if (params?.filter) query.append("filter", params.filter);
    const qs = query.toString();
    const res = await axiosInstance.get<AdminUser[]>(`/admin/users${qs ? `?${qs}` : ""}`);
    return res.data;
  },

  banUser: async (userId: string, banned: boolean): Promise<{ success: boolean; userId: string; banned: boolean }> => {
    const res = await axiosInstance.post<{ success: boolean; userId: string; banned: boolean }>(
      `/admin/users/${userId}/ban`,
      { banned }
    );
    return res.data;
  },

  resetUserStats: async (userId: string): Promise<{ success: boolean; userId: string }> => {
    const res = await axiosInstance.post<{ success: boolean; userId: string }>(
      `/admin/users/${userId}/reset-stats`,
      {}
    );
    return res.data;
  },

  cleanUserProfile: async (userId: string, resetName?: string): Promise<{ success: boolean; userId: string }> => {
    const res = await axiosInstance.post<{ success: boolean; userId: string }>(
      `/admin/users/${userId}/clean-profile`,
      { resetName }
    );
    return res.data;
  },

  adminDeletePost: async (postId: string): Promise<{ success: boolean; id: string }> => {
    const res = await axiosInstance.delete<{ success: boolean; id: string }>(`/admin/posts/${postId}`);
    return res.data;
  },

  getAdminDrinks: async (): Promise<db.Drink[]> => {
    const res = await axiosInstance.get<db.Drink[]>("/admin/drinks");
    return res.data;
  },

  adminUpdateDrink: async (drinkId: string, updates: Partial<db.Drink>): Promise<db.Drink> => {
    const res = await axiosInstance.patch<db.Drink>(`/admin/drinks/${drinkId}`, updates);
    return res.data;
  },

  getAdminRooms: async (): Promise<AdminRoom[]> => {
    const res = await axiosInstance.get<AdminRoom[]>("/admin/rooms");
    return res.data;
  },

  adminDeleteRoom: async (code: string): Promise<{ success: boolean; code: string; removed: boolean }> => {
    const res = await axiosInstance.delete<{ success: boolean; code: string; removed: boolean }>(
      `/admin/rooms/${code}`
    );
    return res.data;
  },

  sendAdminBroadcast: async (message: string): Promise<{ success: boolean; post: any }> => {
    const res = await axiosInstance.post<{ success: boolean; post: any }>("/admin/broadcast", { message });
    return res.data;
  },
};
