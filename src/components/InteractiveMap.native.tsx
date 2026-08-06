import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { User, MapCoordinate } from "@/services/mockData";
import { buildMapHtml, MapMarker } from "./mapHtml";

interface InteractiveMapProps {
  mapItems: MapCoordinate[];
  currentUser: User | null;
  userLocation: { latitude: number; longitude: number } | null;
  onRefreshMap: () => void;
}

/**
 * Native implementation: same Leaflet document as the web version, hosted in
 * a WebView. Deliberately not react-native-maps — that would need a Google
 * Maps API key for Android and wouldn't work on web at all, whereas the
 * OpenStreetMap/CARTO tiles used here need no key and render identically on
 * every platform.
 */
export default function InteractiveMap({
  mapItems,
  currentUser,
  userLocation,
  onRefreshMap,
}: InteractiveMapProps) {
  const markers: MapMarker[] = mapItems.map((item) => ({
    ...item,
    relation: currentUser && item.userId === currentUser.id ? "self" : "friend",
  }));

  const html = buildMapHtml(markers, userLocation);

  return (
    <View className="flex-1 bg-slate-950 border border-white/10 rounded-3xl overflow-hidden relative min-h-[450px]">
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={{ flex: 1, backgroundColor: "#020617" }}
        // The map is display-only; no reason to let it navigate anywhere.
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
        javaScriptEnabled
        domStorageEnabled={false}
      />

      <TouchableOpacity
        onPress={onRefreshMap}
        activeOpacity={0.8}
        className="absolute top-4 left-4 bg-slate-900/90 border border-white/10 p-2 rounded-xl flex-row items-center active:scale-95"
      >
        <Ionicons name="refresh" size={14} color="#22d3ee" />
        <Text className="text-[8px] text-cyan-400 font-black uppercase tracking-widest ml-1.5">
          Aktualisieren
        </Text>
      </TouchableOpacity>

      {mapItems.length === 0 && (
        <View className="absolute bottom-4 left-4 right-4 bg-slate-900/90 border border-white/10 rounded-2xl p-3">
          <Text className="text-white text-[10px] font-black uppercase tracking-wider mb-0.5">
            Noch keine Orte
          </Text>
          <Text className="text-slate-500 text-[9px] font-semibold leading-relaxed">
            Aktiviere den Standort im Menü, um deine Getränke-Orte hier zu sehen.
          </Text>
        </View>
      )}
    </View>
  );
}
