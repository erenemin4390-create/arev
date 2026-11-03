import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { AREV } from "@/components/arev/ui";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: AREV.forest, tabBarInactiveTintColor: "#9BA79A", tabBarButton: HapticTab, tabBarStyle: { paddingTop: 8, paddingBottom: bottomPadding, height: 56 + bottomPadding, backgroundColor: AREV.cream, borderTopColor: AREV.line, borderTopWidth: 0.5 } }}><Tabs.Screen name="index" options={{ title: "İndir", tabBarIcon: ({ color, size }) => <Ionicons name="arrow-down-circle-outline" size={size} color={color} /> }} /><Tabs.Screen name="files" options={{ title: "Dosyalar", tabBarIcon: ({ color, size }) => <Ionicons name="folder-open-outline" size={size} color={color} /> }} /><Tabs.Screen name="settings" options={{ title: "Ayarlar", tabBarIcon: ({ color, size }) => <Ionicons name="options-outline" size={size} color={color} /> }} /></Tabs>;
}
