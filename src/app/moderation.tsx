import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiService, ModerationInbox, ReportStatus } from "@/services/api";
import { triggerHaptic } from "@/services/haptics";
import { notify } from "@/services/dialogs";

const REPORT_GRUENDE: Record<string, string> = {
  belaestigung: "Belästigung",
  spam: "Spam",
  unangemessen: "Unangemessen",
  fake: "Fake-Profil",
  sonstiges: "Sonstiges",
};

const FILTER: { key: ReportStatus; label: string; farbe: string }[] = [
  { key: "open", label: "Offen", farbe: "#fbbf24" },
  { key: "resolved", label: "Erledigt", farbe: "#34d399" },
  { key: "dismissed", label: "Verworfen", farbe: "#64748b" },
];

/**
 * Meldungen bearbeiten.
 *
 * Der Screen erscheint nur im Menü, wenn der Server `isModerator` im eigenen
 * Profil meldet (gesteuert über ADMIN_USER_IDS). Das ist reine Anzeigehilfe —
 * die Routen prüfen unabhängig davon, ein manipulierter Client gewinnt nichts.
 */
export default function ModerationScreen() {
  const [inbox, setInbox] = useState<ModerationInbox | null>(null);
  const [filter, setFilter] = useState<ReportStatus>("open");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (status: ReportStatus) => {
    setLoading(true);
    try {
      setInbox(await apiService.getReports(status));
    } catch (error) {
      notify("Fehler", error instanceof Error ? error.message : "Meldungen konnten nicht geladen werden.");
      setInbox(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const handleStatus = async (id: string, status: ReportStatus) => {
    setBusyId(id);
    try {
      await apiService.setReportStatus(id, status);
      await triggerHaptic("success");
      await load(filter);
    } catch (error) {
      await triggerHaptic("error");
      notify("Fehler", error instanceof Error ? error.message : "Status konnte nicht gesetzt werden.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View className="flex-1 bg-slate-950">
      {/* Filter. Die Zahlen gelten für alle Meldungen, nicht für die
          gefilterte Liste — sonst würde der Zähler vom Filter abhängen. */}
      <View className="px-4 pt-4 pb-3">
        <Text className="text-slate-500 text-[10px] font-semibold mb-3 px-1">
          Die Stores erwarten eine Reaktion binnen 24 Stunden.
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {FILTER.map((f) => {
            const aktiv = filter === f.key;
            const anzahl = inbox?.counts?.[f.key] ?? 0;
            return (
              <TouchableOpacity
                key={f.key}
                onPress={() => {
                  triggerHaptic("light");
                  setFilter(f.key);
                }}
                accessibilityLabel={`Filter ${f.label}`}
                style={{
                  backgroundColor: aktiv ? `${f.farbe}1A` : "#0f172a",
                  borderColor: aktiv ? `${f.farbe}66` : "#1e293b",
                }}
                className="flex-1 border rounded-xl py-2.5 items-center"
              >
                <Text
                  className="text-[10px] font-black uppercase tracking-wider"
                  style={{ color: aktiv ? f.farbe : "#64748b" }}
                >
                  {f.label}
                </Text>
                <Text
                  className="text-[9px] font-black mt-0.5"
                  style={{ color: aktiv ? f.farbe : "#475569" }}
                >
                  {anzahl}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-12"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View className="py-12 items-center">
            <ActivityIndicator color="#fbbf24" />
          </View>
        ) : !inbox || inbox.reports.length === 0 ? (
          <View className="py-12 items-center">
            <Ionicons name="checkmark-done-outline" size={26} color="#334155" />
            <Text className="text-slate-600 text-[11px] font-bold mt-2">Nichts hier. Gut so.</Text>
          </View>
        ) : (
          inbox.reports.map((r) => (
            <View key={r.id} className="bg-slate-900 border border-white/5 rounded-2xl p-3.5 mb-2.5">
              <View className="flex-row items-center mb-1.5">
                <Text className="text-white text-xs font-black flex-1 mr-2" numberOfLines={1}>
                  {r.reportedName}
                </Text>
                <Text className="text-amber-400 text-[9px] font-black uppercase tracking-wider">
                  {REPORT_GRUENDE[r.reason] || r.reason}
                </Text>
              </View>

              <Text className="text-slate-500 text-[9px] font-bold mb-2">
                gemeldet von {r.reporterName} ·{" "}
                {new Date(r.timestamp).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {r.contentType}
              </Text>

              {r.details ? (
                <Text className="text-slate-300 text-[11px] leading-4 mb-2">{r.details}</Text>
              ) : null}

              {/* Der Auszug ist eine Kopie aus dem Meldezeitpunkt — das
                  Original kann längst gelöscht sein. */}
              {r.contentExcerpt ? (
                <View className="bg-slate-950 border border-white/5 rounded-xl p-2.5 mb-2">
                  <Text className="text-slate-400 text-[10px] leading-4 italic" numberOfLines={4}>
                    „{r.contentExcerpt}“
                  </Text>
                </View>
              ) : null}

              {busyId === r.id ? (
                <ActivityIndicator size="small" color="#fbbf24" />
              ) : r.status === "open" ? (
                <View className="flex-row" style={{ gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => handleStatus(r.id, "dismissed")}
                    accessibilityLabel={`Meldung gegen ${r.reportedName} verwerfen`}
                    className="flex-1 bg-slate-950 border border-white/10 rounded-xl py-2.5 items-center"
                  >
                    <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider">
                      Verwerfen
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleStatus(r.id, "resolved")}
                    accessibilityLabel={`Meldung gegen ${r.reportedName} als erledigt markieren`}
                    className="flex-1 bg-emerald-500/10 border border-emerald-500/30 rounded-xl py-2.5 items-center"
                  >
                    <Text className="text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                      Erledigt
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => handleStatus(r.id, "open")}
                  accessibilityLabel={`Meldung gegen ${r.reportedName} wieder öffnen`}
                  className="bg-slate-950 border border-white/10 rounded-xl py-2.5 items-center"
                >
                  <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider">
                    Wieder öffnen
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
