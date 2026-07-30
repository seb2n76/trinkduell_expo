import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Drink, DrinkLog } from "@/services/mockData";
import { Ionicons } from "@expo/vector-icons";

interface StatsChartsProps {
  logs: DrinkLog[];
  drinks: Drink[];
}

export default function StatsCharts({ logs, drinks }: StatsChartsProps) {
  // 1. Process Category Breakdown Data
  const categoryStats = useMemo(() => {
    const counts: Record<string, number> = {
      Bier: 0,
      Wein: 0,
      Sekt: 0,
      Schnaps: 0,
      Mischgetränk: 0,
      Alkoholfrei: 0,
    };

    let totalActiveLogs = 0;

    for (const log of logs) {
      const drink = drinks.find((d) => d.id === log.drinkId);
      if (drink && counts[drink.category] !== undefined) {
        counts[drink.category]++;
        totalActiveLogs++;
      }
    }

    const categoriesList = [
      {
        id: "Bier",
        name: "Bier",
        icon: "beer" as const,
        colorClass: "bg-yellow-500",
        textClass: "text-yellow-400",
        colorHex: "#eab308",
      },
      {
        id: "Wein",
        name: "Wein",
        icon: "wine" as const,
        colorClass: "bg-rose-500",
        textClass: "text-rose-400",
        colorHex: "#f43f5e",
      },
      {
        id: "Sekt",
        name: "Sekt",
        icon: "sparkles" as const,
        colorClass: "bg-pink-500",
        textClass: "text-pink-400",
        colorHex: "#ec4899",
      },
      {
        id: "Schnaps",
        name: "Schnaps",
        icon: "flask" as const,
        colorClass: "bg-purple-500",
        textClass: "text-purple-400",
        colorHex: "#a855f7",
      },
      {
        id: "Mischgetränk",
        name: "Mix",
        icon: "color-filter" as const,
        colorClass: "bg-cyan-500",
        textClass: "text-cyan-400",
        colorHex: "#06b6d4",
      },
      {
        id: "Alkoholfrei",
        name: "Frei",
        icon: "water" as const,
        colorClass: "bg-sky-500",
        textClass: "text-sky-400",
        colorHex: "#0ea5e9",
      },
    ];

    return categoriesList.map((cat) => {
      const count = counts[cat.id] || 0;
      const percent = totalActiveLogs > 0 ? (count / totalActiveLogs) * 100 : 0;
      return {
        ...cat,
        count,
        percent: Number(percent.toFixed(1)),
      };
    });
  }, [logs, drinks]);

  // 2. Process Last 7 Days Weekly Bar Chart Data
  const weeklyData = useMemo(() => {
    const days = [];
    const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    
    // Generate last 7 days starting from 6 days ago up to today
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }

    const chartPoints = days.map((dayDate) => {
      const nextDay = new Date(dayDate);
      nextDay.setDate(nextDay.getDate() + 1);

      // Find logs for this specific day
      const dayLogs = logs.filter((log) => {
        const logTime = new Date(log.timestamp).getTime();
        return logTime >= dayDate.getTime() && logTime < nextDay.getTime();
      });

      // Sum points for the day
      let dayPointsSum = 0;
      for (const log of dayLogs) {
        const drink = drinks.find((d) => d.id === log.drinkId);
        if (drink) {
          const grams = drink.volume * (drink.abv / 100) * 0.789;
          dayPointsSum += 10 + Math.round(grams * 2);
        }
      }

      // Format date labels
      const label = dayNames[dayDate.getDay()];
      const isToday = dayDate.toDateString() === new Date().toDateString();

      return {
        label,
        points: dayPointsSum,
        isToday,
      };
    });

    const maxPoints = Math.max(...chartPoints.map((dp) => dp.points), 10);

    return {
      pointsList: chartPoints,
      maxPoints,
    };
  }, [logs, drinks]);

  return (
    <View className="space-y-6">
      {/* ================= Weekly Bar Chart ================= */}
      <View className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 shadow-xl">
        <Text className="text-white font-extrabold text-sm mb-4">Aktivität (Letzte 7 Tage)</Text>

        <View className="flex-row items-end justify-between h-32 pt-2 px-1">
          {weeklyData.pointsList.map((day, idx) => {
            const heightPercent = (day.points / weeklyData.maxPoints) * 100;

            return (
              <View key={idx} className="items-center flex-1">
                {/* Points count above the bar if points > 0 */}
                <Text className="text-[9px] text-slate-400 font-bold mb-1 h-3">
                  {day.points > 0 ? `${day.points}p` : ""}
                </Text>

                {/* Vertical Bar Container */}
                <View className="w-4 h-20 bg-slate-950/80 rounded-full justify-end overflow-hidden border border-white/5">
                  <View
                    style={{ height: `${Math.max(heightPercent, 2)}%` }}
                    className={`w-full rounded-full ${
                      day.isToday ? "bg-cyan-400 shadow-lg shadow-cyan-400/50" : "bg-slate-800"
                    }`}
                  />
                </View>

                {/* Day Label */}
                <Text
                  className={`text-[10px] font-black mt-2 ${
                    day.isToday ? "text-cyan-400" : "text-slate-500"
                  }`}
                >
                  {day.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ================= Category Breakdown ================= */}
      <View className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 shadow-xl">
        <Text className="text-white font-extrabold text-sm mb-4">Konsum nach Kategorie</Text>

        <View className="space-y-3.5">
          {categoryStats.map((cat) => {
            const isZero = cat.count === 0;

            return (
              <View key={cat.id} className="space-y-1">
                {/* Info Header */}
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center space-x-2">
                    <Ionicons name={cat.icon} size={14} color={cat.colorHex} />
                    <Text className="text-xs font-bold text-slate-300">{cat.name}</Text>
                  </View>
                  <View className="flex-row items-center space-x-1.5">
                    <Text className="text-[10px] font-black text-slate-500">
                      {cat.count}x
                    </Text>
                    <Text className={`text-xs font-black ${cat.textClass}`}>
                      {cat.percent}%
                    </Text>
                  </View>
                </View>

                {/* Bar */}
                <View className="h-2 bg-slate-950 rounded-full overflow-hidden border border-white/5">
                  <View
                    style={{ width: `${cat.percent}%` }}
                    className={`h-full rounded-full ${cat.colorClass} ${
                      isZero ? "opacity-0" : "opacity-100"
                    }`}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}
