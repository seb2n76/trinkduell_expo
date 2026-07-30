import { Platform } from "react-native";

// Central configuration for Trinkduell API endpoints.
// Flip to "production" once your Proxmox/Docker backend is reachable, so the
// app talks to your real server instead of a local dev machine.
export const ACTIVE_ENV: "local" | "production" = "local";

// Set to true to bypass network requests entirely and use local mock data instantly
export const USE_MOCK_ONLY = false;

// TODO: fill in your Proxmox/Docker backend's real address (e.g. its public
// domain or the LXC container's reachable IP), then set ACTIVE_ENV above to
// "production" to use it.
const PRODUCTION_API_URL = "https://your-proxmox-server.example.com";

// Express server base URL for local development
// (use 10.0.2.2 for Android Emulator, localhost for iOS/Web)
const LOCAL_API_URL = Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000";

function resolveApiUrl(env: "local" | "production"): string {
  return env === "production" ? PRODUCTION_API_URL : LOCAL_API_URL;
}

export const API_URL = resolveApiUrl(ACTIVE_ENV);
