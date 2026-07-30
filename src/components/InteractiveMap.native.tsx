/**
 * InteractiveMap.native.tsx
 *
 * GPS/Maps feature is DEACTIVATED for cross-platform stability.
 * react-native-maps is not used to avoid native build failures
 * (missing Google Maps API key, Apple Maps entitlement, etc.).
 *
 * This file re-exports the web/placeholder component so the
 * .native.tsx resolver does not pick up react-native-maps.
 */
export { default } from "./InteractiveMap";
