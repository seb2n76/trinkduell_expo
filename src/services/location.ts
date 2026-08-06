import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const LOCATION_MODE_KEY = "trinkduell_location_mode";

/**
 * How the app is allowed to attach coordinates to drink logs:
 * - "auto":   every logged drink gets the current position (builds a full
 *             history of where you drank, powers the map trail)
 * - "manual": only an explicit check-in records a position
 * - "off":    no coordinates are ever collected
 *
 * Defaults to "off" — location is the most sensitive data this app touches,
 * so it must be a deliberate opt-in rather than something users discover
 * after the fact.
 */
export type LocationMode = "auto" | "manual" | "off";

export const DEFAULT_LOCATION_MODE: LocationMode = "off";

export async function getLocationMode(): Promise<LocationMode> {
  try {
    const stored = await AsyncStorage.getItem(LOCATION_MODE_KEY);
    if (stored === "auto" || stored === "manual" || stored === "off") return stored;
    return DEFAULT_LOCATION_MODE;
  } catch {
    return DEFAULT_LOCATION_MODE;
  }
}

export async function setLocationMode(mode: LocationMode): Promise<void> {
  await AsyncStorage.setItem(LOCATION_MODE_KEY, mode);
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Asks for permission if needed. Returns false when the user declines —
 * callers must keep working without coordinates in that case.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const { status: existing } = await Location.getForegroundPermissionsAsync();
    if (existing === "granted") return true;

    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  } catch (error) {
    console.warn("[Location] Permission check failed:", error);
    return false;
  }
}

/**
 * Current position, or null if unavailable for any reason (permission
 * denied, GPS off, timeout, web without secure context...). Never throws:
 * logging a drink must succeed even when the location lookup doesn't.
 */
export async function getCurrentCoordinates(): Promise<Coordinates | null> {
  try {
    const granted = await ensureLocationPermission();
    if (!granted) return null;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch (error) {
    console.warn("[Location] Could not determine position:", error);
    return null;
  }
}

/**
 * Coordinates for a drink log, honouring the user's chosen mode.
 * In "manual" mode a normal drink log gets no position — only an explicit
 * check-in (which calls getCurrentCoordinates directly) does.
 */
export async function getCoordinatesForDrinkLog(): Promise<Coordinates | null> {
  const mode = await getLocationMode();
  if (mode !== "auto") return null;
  return getCurrentCoordinates();
}

/**
 * Web needs a secure context (https or localhost) for the Geolocation API.
 * Used to explain in the UI why the toggle may not work in a browser tab.
 */
export function isLocationAvailableOnPlatform(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}
