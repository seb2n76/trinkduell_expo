import React, { useEffect, useRef } from "react";
import { View, Animated, ViewStyle, DimensionValue } from "react-native";

interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  className?: string;
  style?: ViewStyle;
}

/**
 * Universelle animierte Skeleton-Komponente mit sanftem Puls-Effekt.
 * Funktioniert plattformübergreifend (Web, iOS, Android) ohne native Abhängigkeiten.
 */
export function Skeleton({
  width,
  height,
  borderRadius = 8,
  className = "",
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.75,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: "#334155", // slate-700
          opacity,
        },
        style,
      ]}
      className={className}
    />
  );
}

/**
 * Skeleton für einen einzelnen Eintrag im Freunde-Radar.
 */
export function RadarEntrySkeleton() {
  return (
    <View className="items-center mx-1.5 w-20">
      <Skeleton width={56} height={56} borderRadius={28} className="mb-2" />
      <Skeleton width={48} height={10} borderRadius={5} className="mb-1" />
      <Skeleton width={32} height={8} borderRadius={4} />
    </View>
  );
}

/**
 * Skeleton für das gesamte Freunde-Radar (z. B. 4 Freunde).
 */
export function FriendsRadarSkeleton() {
  return (
    <View className="flex-row -mx-1">
      <RadarEntrySkeleton />
      <RadarEntrySkeleton />
      <RadarEntrySkeleton />
      <RadarEntrySkeleton />
    </View>
  );
}

/**
 * Skeleton für einen Feed-Beitrag / Drink-Log im Social-Feed.
 */
export function FeedItemSkeleton() {
  return (
    <View className="bg-white/5 border border-white/10 p-4 rounded-3xl mb-4 shadow-lg">
      {/* Header: Avatar, Name, Timestamp */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center flex-1 mr-3">
          <Skeleton width={40} height={40} borderRadius={20} className="mr-3" />
          <View className="flex-1">
            <View className="flex-row items-center mb-1.5">
              <Skeleton width={90} height={12} borderRadius={6} className="mr-2" />
              <Skeleton width={45} height={12} borderRadius={6} />
            </View>
            <Skeleton width={60} height={9} borderRadius={4} />
          </View>
        </View>
        <Skeleton width={30} height={16} borderRadius={8} />
      </View>

      {/* Content preview */}
      <View className="mb-3.5 pl-12">
        <Skeleton width="85%" height={14} borderRadius={6} className="mb-2" />
        <Skeleton width="60%" height={12} borderRadius={6} />
      </View>

      {/* Footer / Reaction Buttons */}
      <View className="flex-row items-center pt-2.5 border-t border-white/5 pl-12">
        <Skeleton width={65} height={24} borderRadius={12} className="mr-2" />
        <Skeleton width={75} height={24} borderRadius={12} />
      </View>
    </View>
  );
}

/**
 * Skeleton für das Podium auf dem Scoreboard (Platz 2, 1, 3).
 */
export function ScoreboardPodiumSkeleton() {
  return (
    <View className="flex-row justify-center items-end mt-4 mb-8 px-1">
      {/* #2 Place */}
      <View className="items-center mx-1.5 w-[28%] bg-white/5 border border-slate-700/40 rounded-2xl p-2.5 pt-6" style={{ minHeight: 135 }}>
        <Skeleton width={44} height={44} borderRadius={22} className="mb-2" />
        <Skeleton width={50} height={12} borderRadius={6} className="mb-1.5" />
        <Skeleton width={35} height={10} borderRadius={5} className="mb-2" />
        <Skeleton width={45} height={14} borderRadius={7} />
      </View>

      {/* #1 Place */}
      <View className="items-center mx-1.5 w-[33%] bg-white/5 border-2 border-yellow-500/30 rounded-3xl p-3.5 pt-8 shadow-md" style={{ minHeight: 165 }}>
        <Skeleton width={52} height={52} borderRadius={26} className="mb-2" />
        <Skeleton width={60} height={14} borderRadius={7} className="mb-1.5" />
        <Skeleton width={40} height={12} borderRadius={6} className="mb-2" />
        <Skeleton width={55} height={16} borderRadius={8} />
      </View>

      {/* #3 Place */}
      <View className="items-center mx-1.5 w-[28%] bg-white/5 border border-amber-800/40 rounded-2xl p-2.5 pt-6" style={{ minHeight: 135 }}>
        <Skeleton width={44} height={44} borderRadius={22} className="mb-2" />
        <Skeleton width={50} height={12} borderRadius={6} className="mb-1.5" />
        <Skeleton width={35} height={10} borderRadius={5} className="mb-2" />
        <Skeleton width={45} height={14} borderRadius={7} />
      </View>
    </View>
  );
}

/**
 * Skeleton für eine Ranglisten-Zeile (ab Platz 4).
 */
export function ScoreboardRowSkeleton() {
  return (
    <View className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-3 shadow-lg flex-row items-center justify-between">
      <View className="flex-row items-center flex-1 mr-3">
        <Skeleton width={16} height={14} borderRadius={4} className="mr-3" />
        <Skeleton width={36} height={36} borderRadius={18} className="mr-3" />
        <View className="flex-1">
          <View className="flex-row items-center mb-1.5">
            <Skeleton width={80} height={12} borderRadius={6} className="mr-2" />
            <Skeleton width={35} height={10} borderRadius={4} className="mr-1" />
            <Skeleton width={40} height={10} borderRadius={4} />
          </View>
          <Skeleton width={50} height={9} borderRadius={4} />
        </View>
      </View>

      <View className="items-end">
        <Skeleton width={32} height={16} borderRadius={6} className="mb-1" />
        <Skeleton width={44} height={9} borderRadius={4} />
      </View>
    </View>
  );
}
