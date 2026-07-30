/* eslint-disable import/no-named-as-default-member */
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { API_URL } from "./config";

const QUEUE_KEY = "trinkduell_sync_queue";

export interface SyncJob {
  id: string;
  action: "LOG_DRINK" | "DELETE_DRINK_LOG" | "CREATE_POST" | "CREATE_DRINK" | "DELETE_DRINK" | "UPDATE_USER" | "JOIN_GROUP";
  payload: any;
  timestamp: string;
}

// Dedicated Axios client for synchronization to bypass the circuit breaker and hit the server directly
const syncAxios = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Sync request interceptor to apply active token
syncAxios.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem("trinkduell_v2_jwt_token");
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn("Failed to apply token to sync request:", e);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

let isSyncing = false;

export const SyncService = {
  // Add a mutation job to the queue
  enqueueSyncJob: async (action: SyncJob["action"], payload: any): Promise<void> => {
    try {
      const rawQueue = await AsyncStorage.getItem(QUEUE_KEY);
      const queue: SyncJob[] = rawQueue ? JSON.parse(rawQueue) : [];

      const job: SyncJob = {
        id: `job-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        action,
        payload,
        timestamp: new Date().toISOString(),
      };

      queue.push(job);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      console.log(`[SyncService] Enqueued offline job: ${action}`, payload);
    } catch (error) {
      console.error("[SyncService] Failed to enqueue sync job:", error);
    }
  },

  // Process all pending jobs in the queue
  processQueue: async (): Promise<void> => {
    if (isSyncing) return;
    isSyncing = true;

    try {
      const rawQueue = await AsyncStorage.getItem(QUEUE_KEY);
      if (!rawQueue) {
        isSyncing = false;
        return;
      }

      let queue: SyncJob[] = JSON.parse(rawQueue);
      if (queue.length === 0) {
        isSyncing = false;
        return;
      }

      console.log(`[SyncService] Starting sync for ${queue.length} pending jobs...`);

      // Process sequentially
      while (queue.length > 0) {
        const job = queue[0];
        let success = false;

        try {
          switch (job.action) {
            case "LOG_DRINK":
              await syncAxios.post("/logs", {
                drinkId: job.payload.drinkId,
                eventId: job.payload.eventId,
                timestamp: job.payload.timestamp,
              });
              break;

            case "DELETE_DRINK_LOG":
              await syncAxios.delete(`/logs/${job.payload.logId}`);
              break;

            case "CREATE_POST":
              await syncAxios.post("/posts", {
                text: job.payload.text,
                contextType: job.payload.contextType,
                contextId: job.payload.contextId,
                image: job.payload.image,
              });
              break;

            case "CREATE_DRINK":
              await syncAxios.post("/drinks", {
                name: job.payload.name,
                category: job.payload.category,
                volume: job.payload.volume,
                abv: job.payload.abv,
                calories: job.payload.calories,
              });
              break;

            case "DELETE_DRINK":
              await syncAxios.delete(`/drinks/${job.payload.drinkId}`);
              break;

            case "UPDATE_USER":
              await syncAxios.put(`/users/${job.payload.userId}`, job.payload.user);
              break;

            case "JOIN_GROUP":
              await syncAxios.post(`/groups/${job.payload.groupId}/join`);
              break;

            default:
              console.warn(`[SyncService] Unknown action: ${job.action}`);
              success = true; // Drop unknown actions
          }
          success = true;
        } catch (err: any) {
          // Network errors (e.g. status 5xx, or network failure) -> halt synchronization
          if (!err.response || err.response.status >= 500 || err.code === "ECONNABORTED") {
            console.warn("[SyncService] Network error during sync. Pausing queue processing.", err.message);
            break;
          }
          
          // Client errors (4xx) -> invalid state, log warning and drop the job to prevent queue blockages
          console.warn(`[SyncService] Drop job ${job.id} due to permanent 4xx error:`, err.response?.status, err.message);
          success = true;
        }

        if (success) {
          queue.shift(); // Remove completed job
          await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        }
      }

      console.log(`[SyncService] Sync finished. Remaining queue size: ${queue.length}`);
    } catch (error) {
      console.error("[SyncService] Error processing sync queue:", error);
    } finally {
      isSyncing = false;
    }
  },

  // Get Queue length
  getQueueLength: async (): Promise<number> => {
    try {
      const rawQueue = await AsyncStorage.getItem(QUEUE_KEY);
      if (!rawQueue) return 0;
      const queue: SyncJob[] = JSON.parse(rawQueue);
      return queue.length;
    } catch {
      return 0;
    }
  }
};
