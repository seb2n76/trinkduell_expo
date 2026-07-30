import React from "react";
import { View, Image, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { User, MapCoordinate } from "@/services/mockData";

interface InteractiveMapProps {
  mapItems: MapCoordinate[];
  currentUser: User | null;
  friendIds: Set<string>;
  userLocation: { latitude: number; longitude: number } | null;
  onRefreshMap: () => void;
}

export default function InteractiveMap({
  mapItems,
  currentUser,
  friendIds,
  userLocation,
  onRefreshMap,
}: InteractiveMapProps) {
  // Helper to project Munich coordinates to grid top/left percentage
  const getMapPosition = (latitude?: number | null, longitude?: number | null) => {
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null || isNaN(latitude) || isNaN(longitude)) {
      return { top: "50%", left: "50%" };
    }
    const latCenter = userLocation?.latitude || 48.1351;
    const lngCenter = userLocation?.longitude || 11.5820;
    
    // Coordinate scatter box
    const maxDelta = 0.025;
    
    let latNorm = (latitude - latCenter) / maxDelta; // Normalized from -1 to 1
    let lngNorm = (longitude - lngCenter) / maxDelta; // Normalized from -1 to 1
    
    // Clamp to boundaries
    latNorm = Math.max(-1, Math.min(1, latNorm));
    lngNorm = Math.max(-1, Math.min(1, lngNorm));
    
    // Map to screen percentage
    const topPct = 50 - (latNorm * 38);
    const leftPct = 50 + (lngNorm * 38);
    
    return {
      top: `${topPct}%`,
      left: `${leftPct}%`,
    };
  };

  return (
    <View className="flex-1 bg-slate-950 border border-white/10 rounded-3xl overflow-hidden relative min-h-[450px]">
      
      {/* Cyber-Neon Dark Styled Grid Map Backdrop */}
      <View className="absolute inset-0 bg-[#090d16]">
        {/* Map grid lines simulation */}
        <View className="absolute left-1/4 top-0 bottom-0 w-0.5 bg-white/5" />
        <View className="absolute left-2/4 top-0 bottom-0 w-0.5 bg-white/5" />
        <View className="absolute left-3/4 top-0 bottom-0 w-0.5 bg-white/5" />
        <View className="absolute top-1/4 left-0 right-0 h-0.5 bg-white/5" />
        <View className="absolute top-2/4 left-0 right-0 h-0.5 bg-white/5" />
        <View className="absolute top-3/4 left-0 right-0 h-0.5 bg-white/5" />
        
        {/* Semi-static Heatmap Glow zones (Visual ambient effects) */}
        <View className="absolute top-[28%] left-[20%] w-24 h-24 bg-cyan-500/10 rounded-full border border-cyan-400/20 shadow-2xl items-center justify-center">
          <View className="w-10 h-10 bg-cyan-400/20 rounded-full items-center justify-center" />
        </View>
        <View className="absolute top-[62%] left-[65%] w-32 h-32 bg-fuchsia-500/10 rounded-full border border-fuchsia-400/20 shadow-2xl items-center justify-center">
          <View className="w-14 h-14 bg-fuchsia-400/20 rounded-full items-center justify-center" />
        </View>

        {/* DYNAMIC MARKERS ON MAP */}
        {mapItems.map((item) => {
          const isMe = currentUser && item.userId === currentUser.id;
          const isFriend = friendIds.has(item.userId);
          const pos = getMapPosition(item.latitude, item.longitude);

          const borderStyle = isMe ? "border-cyan-400" : isFriend ? "border-fuchsia-500" : "border-yellow-400";
          const badgeBg = isMe ? "bg-cyan-400" : isFriend ? "bg-fuchsia-500" : "bg-yellow-400";
          const badgeText = isMe ? "text-slate-950" : "text-white";

          return (
            <View
              key={`pin-${item.id}`}
              style={{
                position: "absolute",
                top: pos.top as any,
                left: pos.left as any,
                transform: "translate(-50%, -50%)" as any,
              }}
              className="items-center z-30 group cursor-pointer"
            >
              <View className={`bg-slate-950 p-0.5 rounded-full border-2 ${borderStyle} shadow-2xl`}>
                <Image
                  source={{ uri: item.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80" }}
                  style={{ width: 32, height: 32 }}
                  className="rounded-full"
                />
              </View>
              <View className={`${badgeBg} px-2 py-0.5 rounded-full border border-slate-950 mt-1 shadow-md`}>
                <Text className={`text-[7px] font-black uppercase ${badgeText}`} numberOfLines={1}>
                  {isMe ? "Du" : item.username.split(" ")[0]}
                </Text>
              </View>
              
              {/* Web Tooltip on Hover / Click simulation */}
              <View 
                style={{ display: "none" }}
                className="group-hover:flex absolute bottom-full mb-2 bg-slate-900 border border-white/10 p-3 rounded-2xl shadow-xl w-48 z-50 pointer-events-none"
              >
                <Text className="text-white font-black text-xs mb-1">{item.username}</Text>
                <Text className="text-slate-300 text-[10px] font-bold">{item.drinkName}</Text>
                <Text className="text-slate-500 text-[8px] font-bold mt-1">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} Uhr
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Map Legend Card */}
      <View className="absolute bottom-4 left-4 right-4 bg-slate-900/90 border border-white/10 rounded-2xl p-3 flex-row justify-between items-center pointer-events-none">
        <View>
          <Text className="text-white text-[10px] font-black uppercase tracking-wider">Trink-Heatmap (Web-Modus)</Text>
          <Text className="text-slate-500 text-[8px] font-bold mt-0.5">Pins zeigen relative GPS-Standorte der Crew</Text>
        </View>
        <View className="flex-row space-x-2">
          <View className="flex-row items-center space-x-1">
            <View className="w-2 h-2 rounded-full bg-cyan-400" />
            <Text className="text-[8px] text-slate-400 font-extrabold">Du</Text>
          </View>
          <View className="flex-row items-center space-x-1">
            <View className="w-2 h-2 rounded-full bg-fuchsia-500" />
            <Text className="text-[8px] text-slate-400 font-extrabold">Crew</Text>
          </View>
          <View className="flex-row items-center space-x-1">
            <View className="w-2 h-2 rounded-full bg-yellow-400" />
            <Text className="text-[8px] text-slate-400 font-extrabold">Fremde</Text>
          </View>
        </View>
      </View>

      {/* Map Control Live Badge */}
      <TouchableOpacity
        onPress={onRefreshMap}
        activeOpacity={0.8}
        className="absolute top-4 right-4 bg-slate-900/80 border border-white/10 p-1.5 rounded-xl flex-row items-center space-x-2 active:scale-95"
      >
        <Ionicons name="refresh" size={14} color="#22d3ee" />
        <View className="w-0.5 h-4 bg-white/10" />
        <Text className="text-[8px] text-cyan-400 font-black uppercase tracking-widest px-1">LIVE-PULSE</Text>
      </TouchableOpacity>
    </View>
  );
}
