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
  timeout: 1500, // Fail-fast on festivals or low bandwidth
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


// Circuit Breaker state to prevent network timeout lags when server is offline
let isServerOffline = false;
let lastServerCheckTime = 0;
const SERVER_CHECK_INTERVAL = 30000; // 30 seconds

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
    // Trip circuit breaker on failure
    isServerOffline = true;
    lastServerCheckTime = now;
    console.warn("Network request failed, falling back to local database:", error);
    if (onOffline) onOffline();
    // Silently fall back to local AsyncStorage database emulator
    return await localFallback();
  }
}

export const apiService = {
  // Users
  getUsers: (): Promise<db.User[]> =>
    executeApiCall(
      () => axiosInstance.get<db.User[]>("/users"),
      () => db.getUsers()
    ),
  
  getCurrentUser: async (): Promise<db.User> => {
    const currentId = await db.getCurrentUserId();
    return executeApiCall(
      () => axiosInstance.get<db.User>(`/users/${currentId}`),
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

  createPost: (text: string, contextType: "group" | "event", contextId: string, image?: string): Promise<db.Post> =>
    executeApiCall(
      () => axiosInstance.post<db.Post>("/posts", { text, contextType, contextId, image }),
      () => db.createPost(text, contextType, contextId, image),
      () => SyncService.enqueueSyncJob("CREATE_POST", { text, contextType, contextId, image })
    ),

  // Auth Operations
  login: (emailOrUsername: string, password: string): Promise<{ user: db.User; token: string }> =>
    executeApiCall(
      () => axiosInstance.post<{ user: db.User; token: string }>("/auth/login", { emailOrUsername, password }),
      () => db.mockLogin(emailOrUsername, password)
    ),

  register: (username: string, email: string, password: string): Promise<{ user: db.User; token: string }> =>
    executeApiCall(
      () => axiosInstance.post<{ user: db.User; token: string }>("/auth/register", { username, email, password }),
      () => db.mockRegister(username, email, password)
    ),

  logout: (): Promise<void> =>
    executeApiCall(
      () => axiosInstance.post<void>("/auth/logout"),
      () => db.mockLogout()
    ),

  // Deliberately bypasses executeApiCall's offline fallback: deleting an
  // account only locally while the real server-side account (and its data)
  // survives would be misleading, so this requires an actual connection and
  // throws if the server can't be reached instead of silently "succeeding".
  deleteAccount: async (userId: string): Promise<void> => {
    await axiosInstance.delete<void>(`/users/${userId}`);
  },

  forgotPassword: (email: string): Promise<{ message: string; code?: string }> =>
    executeApiCall(
      () => axiosInstance.post<{ message: string; code?: string }>("/auth/forgot-password", { email }),
      () => db.mockForgotPassword(email)
    ),

  resetPassword: (email: string, code: string, newPassword: string): Promise<{ success: boolean }> =>
    executeApiCall(
      () => axiosInstance.post<{ success: boolean }>("/auth/reset-password", { email, code, newPassword }),
      () => db.mockResetPassword(email, code, newPassword)
    ),

  getSession: (): Promise<{ user: db.User; token: string } | null> =>
    executeApiCall(
      () => axiosInstance.get<{ user: db.User; token: string } | null>("/auth/session"),
      () => db.mockGetSession()
    ),

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

        if (user) {
          user.avatar = savedUrl;
          await db.updateUser(user);
        }
        return { avatarUrl: savedUrl };
      },
      () => {
        // Enqueue user update for the avatar image data
        SyncService.enqueueSyncJob("UPDATE_USER", {
          userId,
          user: {
            id: userId,
            avatar: base64Data ? `data:image/jpeg;base64,${base64Data}` : imageUri
          }
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
            pending: res.data.pending || []
          }
        };
      },
      () => db.getFriends(username)
    ),

  getMap: (): Promise<db.MapCoordinate[]> =>
    executeApiCall(
      () => axiosInstance.get<db.MapCoordinate[]>("/map"),
      () => db.getMapCoordinates()
    ),

  searchUsers: (query: string): Promise<db.User[]> =>
    executeApiCall(
      () => axiosInstance.get<db.User[]>(`/users/search?q=${encodeURIComponent(query)}`),
      () => db.searchUsers(query)
    ),

  getDirectMessages: (otherUserId: string): Promise<db.DirectMessage[]> =>
    executeApiCall(
      () => axiosInstance.get<db.DirectMessage[]>(`/messages/direct/${otherUserId}`),
      () => Promise.resolve([])
    ),

  getGroupMessages: (groupId: string): Promise<db.DirectMessage[]> =>
    executeApiCall(
      () => axiosInstance.get<db.DirectMessage[]>(`/messages/group/${groupId}`),
      () => Promise.resolve([])
    ),

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
};

