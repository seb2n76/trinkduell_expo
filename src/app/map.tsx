import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { apiService } from "@/services/api";
import { User, MapCoordinate } from "@/services/mockData";
import { getCurrentCoordinates, getLocationMode } from "@/services/location";

// The map pulls in the whole Leaflet document builder, so it stays in its own
// chunk instead of the bundle everyone downloads on first load.
const InteractiveMap = React.lazy(() => import("@/components/InteractiveMap"));

/**
 * Die Karte.
 *
 * Lag bis zur Navigations-Umstellung aufgeklappt mitten im Feed und schob mit
 * 450 px Höhe alles darunter aus dem Bild — man scrollte an einer halben
 * Bildschirmseite Karte vorbei, um zu den Aktivitäten zu kommen. Als eigener
 * Screen bekommt sie die volle Fläche und der Feed seine zurück.
 */
export default function MapScreen() {
  const [mapItems, setMapItems] = useState<MapCoordinate[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const me = await apiService.getCurrentUser();
      if (!me) return;
      setCurrentUser(me);
      setMapItems(await apiService.getMap(me.name));

      // Only center on the live position if the user actually enabled
      // location — otherwise the map centers on the pins instead.
      const mode = await getLocationMode();
      if (mode !== "off") {
        const coords = await getCurrentCoordinates();
        if (coords) setUserLocation(coords);
      }
    } catch (e) {
      console.warn("Karte konnte nicht geladen werden:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#22d3ee" />
        <Text className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-3">
          Karte wird geladen
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950 p-3">
      <React.Suspense
        fallback={
          <View className="flex-1 bg-slate-950 border border-white/10 rounded-3xl items-center justify-center">
            <ActivityIndicator color="#22d3ee" />
          </View>
        }
      >
        <InteractiveMap
          mapItems={mapItems}
          currentUser={currentUser}
          userLocation={userLocation}
          onRefreshMap={load}
        />
      </React.Suspense>
    </View>
  );
}
