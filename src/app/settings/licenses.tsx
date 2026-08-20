import React from "react";
import { View, Text, ScrollView } from "react-native";

const LIBRARIES = [
  { name: "React & React Native", license: "MIT License", copyright: "Copyright (c) Meta Platforms, Inc." },
  { name: "Expo SDK (Router, Haptics, ImagePicker)", license: "MIT License", copyright: "Copyright (c) 2015-present 650 Industries, Inc." },
  { name: "TailwindCSS & NativeWind v4", license: "MIT License", copyright: "Copyright (c) Tailwind Labs / Marc Rousavy" },
  { name: "Axios Network client", license: "MIT License", copyright: "Copyright (c) 2014-present Matt Zabriskie" },
  { name: "PostgreSQL Database driver (pg)", license: "MIT License", copyright: "Copyright (c) 2010-present Brian Carlson" },
  { name: "Express backend core", license: "MIT License", copyright: "Copyright (c) 2009-2014 TJ Holowaychuk" },
];

export default function LicensesScreen() {
  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full self-center" style={{ maxWidth: 640 }}>
          <Text className="text-content-muted text-xs leading-relaxed mb-6">
            TrinkDuell ist 100% werbefrei, open-source-konform und respektiert deine Privatsphäre.
            Wir nutzen freie Software unter permissiven Lizenzen (MIT / BSD).
          </Text>

          {LIBRARIES.map((lib) => (
            <View key={lib.name} className="bg-surface border border-line rounded-2xl p-4 mb-3">
              <Text className="text-accent-ink text-sm font-black">{lib.name}</Text>
              <Text className="text-content-faint text-[9px] font-extrabold uppercase mt-1">
                {lib.license}
              </Text>
              <Text className="text-content-faint text-[10px] mt-1.5 leading-relaxed">
                {lib.copyright}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
