import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiService } from "@/services/api";
import { GroupQuest } from "@/services/mockData";
import { triggerHaptic } from "@/services/haptics";
import { notify } from "@/services/dialogs";

const QUEST_TYPEN = [
  { key: "drinks" as const, label: "Getränke", einheit: "Stück", icon: "beer-outline" },
  { key: "volume" as const, label: "Volumen", einheit: "Liter", icon: "water-outline" },
  { key: "water" as const, label: "Wasser", einheit: "Gläser", icon: "fitness-outline" },
];

const questEinheit = (typ: string) => QUEST_TYPEN.find((t) => t.key === typ)?.einheit ?? "";

/**
 * Quests einer Gruppe.
 *
 * Der Fortschritt wird nicht gespeichert, sondern bei jedem GET /api/quests
 * aus den Trink-Logs der Gruppenmitglieder neu berechnet. Ein Abruf ist
 * deshalb immer aktuell — und ein Neuladen nach jeder Aktion nötig.
 */
export default function GroupQuestsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  const [quests, setQuests] = useState<GroupQuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<"drinks" | "volume" | "water">("drinks");
  const [newTarget, setNewTarget] = useState("10");
  const [newHours, setNewHours] = useState("6");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const alle = await apiService.getGroupQuests();
      setQuests(alle.filter((q) => q.groupId === id));
    } catch (e) {
      notify("Fehler", e instanceof Error ? e.message : "Quests konnten nicht geladen werden.");
      setQuests([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleCreate = async () => {
    setError("");

    const titel = newTitle.trim();
    if (titel.length < 2) {
      setError("Der Titel braucht mindestens 2 Zeichen.");
      return;
    }
    const ziel = parseFloat(newTarget.replace(",", "."));
    if (!Number.isFinite(ziel) || ziel <= 0) {
      setError("Das Ziel muss eine Zahl größer als 0 sein.");
      return;
    }
    const stunden = parseInt(newHours, 10);
    if (!Number.isFinite(stunden) || stunden < 1 || stunden > 168) {
      setError("Die Dauer muss zwischen 1 und 168 Stunden liegen.");
      return;
    }

    setBusy(true);
    try {
      await apiService.createGroupQuest(id, titel, newType, ziel, stunden);
      await triggerHaptic("success");
      setNewTitle("");
      setShowForm(false);
      await load();
    } catch (e) {
      await triggerHaptic("error");
      setError(e instanceof Error ? e.message : "Quest konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ title: name ? `Quests · ${name}` : "Quests" }} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-5 pb-16"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          <Text className="text-slate-500 text-[10px] font-semibold mb-5 px-1 leading-4">
            Gemeinsames Ziel für {name || "die Gruppe"}. Zählt alles, was Mitglieder im Zeitraum
            eintragen.
          </Text>

          {loading ? (
            <View className="py-12 items-center">
              <ActivityIndicator color="#34d399" />
            </View>
          ) : quests.length === 0 ? (
            <View className="py-12 bg-slate-900/40 border border-white/5 rounded-2xl items-center justify-center mb-6">
              <Ionicons name="trophy-outline" size={32} color="#475569" />
              <Text className="text-slate-500 text-xs font-bold text-center mt-2">
                Noch keine Quest.
              </Text>
            </View>
          ) : (
            <View className="mb-6">
              {quests.map((q) => {
                const anteil =
                  q.targetValue > 0 ? Math.min(100, (q.currentValue / q.targetValue) * 100) : 0;
                const farbe =
                  q.status === "completed" ? "#34d399" : q.status === "failed" ? "#f43f5e" : "#22d3ee";
                return (
                  <View key={q.id} className="bg-slate-900 border border-white/5 rounded-2xl p-3.5 mb-2.5">
                    <View className="flex-row items-center mb-2">
                      <Text className="text-white text-xs font-black flex-1 mr-2" numberOfLines={1}>
                        {q.title}
                      </Text>
                      <Text
                        className="text-[9px] font-black uppercase tracking-wider"
                        style={{ color: farbe }}
                      >
                        {q.status === "completed"
                          ? "geschafft"
                          : q.status === "failed"
                          ? "verpasst"
                          : "läuft"}
                      </Text>
                    </View>
                    <View className="h-2 w-full bg-slate-950 rounded-full overflow-hidden mb-1.5">
                      <View
                        style={{ width: `${anteil}%`, backgroundColor: farbe }}
                        className="h-full rounded-full"
                      />
                    </View>
                    <Text className="text-slate-500 text-[9px] font-bold">
                      {q.currentValue} / {q.targetValue} {questEinheit(q.type)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Das Anlegen ist eine eigene Handlung, kein Anhängsel der Liste —
              eingeklappt, bis jemand es tatsächlich will. */}
          {!showForm ? (
            <TouchableOpacity
              onPress={() => {
                triggerHaptic("light");
                setError("");
                setShowForm(true);
              }}
              accessibilityLabel="Neue Quest anlegen"
              className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl py-3.5 items-center flex-row justify-center"
            >
              <Ionicons name="add" size={16} color="#34d399" />
              <Text className="text-emerald-400 text-xs font-black uppercase tracking-wider ml-2">
                Neue Quest
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="border-t border-white/5 pt-5">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-white/40 text-[10px] font-black uppercase tracking-widest">
                  Neue Quest
                </Text>
                <TouchableOpacity onPress={() => setShowForm(false)} className="p-1">
                  <Ionicons name="close" size={18} color="#64748b" />
                </TouchableOpacity>
              </View>

              <TextInput
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Titel, z. B. 50 Getränke zusammen"
                placeholderTextColor="#475569"
                maxLength={80}
                accessibilityLabel="Quest-Titel"
                className="bg-slate-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm mb-2.5"
              />

              <View className="flex-row mb-2.5" style={{ gap: 8 }}>
                {QUEST_TYPEN.map((t) => {
                  const aktiv = newType === t.key;
                  return (
                    <TouchableOpacity
                      key={t.key}
                      onPress={() => setNewType(t.key)}
                      accessibilityLabel={`Quest-Typ ${t.label}`}
                      className={`flex-1 py-2.5 rounded-xl border items-center ${
                        aktiv ? "bg-emerald-500/10 border-emerald-500/40" : "bg-slate-900 border-white/5"
                      }`}
                    >
                      <Ionicons name={t.icon as any} size={14} color={aktiv ? "#34d399" : "#64748b"} />
                      <Text
                        className={`text-[9px] font-black uppercase mt-1 ${
                          aktiv ? "text-emerald-400" : "text-slate-500"
                        }`}
                      >
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View className="flex-row mb-2.5" style={{ gap: 8 }}>
                <View className="flex-1">
                  <Text className="text-slate-500 text-[9px] font-black uppercase mb-1.5">
                    Ziel ({questEinheit(newType)})
                  </Text>
                  <TextInput
                    value={newTarget}
                    onChangeText={setNewTarget}
                    keyboardType="numeric"
                    accessibilityLabel="Zielwert"
                    className="bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-slate-500 text-[9px] font-black uppercase mb-1.5">
                    Dauer (Std)
                  </Text>
                  <TextInput
                    value={newHours}
                    onChangeText={setNewHours}
                    keyboardType="numeric"
                    accessibilityLabel="Dauer in Stunden"
                    className="bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm"
                  />
                </View>
              </View>

              {error ? (
                <View className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3 mb-2.5 flex-row items-start">
                  <Ionicons name="alert-circle" size={15} color="#f43f5e" />
                  <Text className="text-rose-400 text-[11px] leading-4 ml-2 flex-1">{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleCreate}
                disabled={busy || !newTitle.trim()}
                accessibilityLabel="Quest anlegen"
                className={`rounded-2xl py-3 items-center ${
                  busy || !newTitle.trim() ? "bg-slate-800" : "bg-emerald-500"
                }`}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <Text
                    className={`text-[11px] font-black uppercase tracking-wider ${
                      !newTitle.trim() ? "text-slate-600" : "text-slate-950"
                    }`}
                  >
                    Quest anlegen
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
