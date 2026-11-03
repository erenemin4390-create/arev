import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export const AREV = {
  cream: "#FCFAF2",
  forest: "#254C3B",
  lime: "#C6E884",
  cocoa: "#8A5A44",
  ink: "#1D2B24",
  muted: "#69766C",
  line: "#E5E8D9",
  white: "#FFFFFF",
  error: "#A44233",
};

export function Wordmark() {
  return <Text style={styles.wordmark}>AREV</Text>;
}

export function IconBadge({ name, tone = "lime" }: { name: keyof typeof Ionicons.glyphMap; tone?: "lime" | "forest" }) {
  return (
    <View style={[styles.iconBadge, { backgroundColor: tone === "lime" ? AREV.lime : AREV.forest }]}>
      <Ionicons name={name} size={20} color={tone === "lime" ? AREV.forest : AREV.lime} />
    </View>
  );
}

export function PrimaryButton({ children, onPress, disabled, loading, icon }: { children: ReactNode; onPress: () => void; disabled?: boolean; loading?: boolean; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [styles.primaryButton, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
      {loading ? <ActivityIndicator color={AREV.forest} /> : icon ? <Ionicons name={icon} size={19} color={AREV.forest} /> : null}
      <Text style={styles.primaryText}>{children}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ children, onPress, icon }: { children: ReactNode; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>{icon ? <Ionicons name={icon} size={18} color={AREV.forest} /> : null}<Text style={styles.secondaryText}>{children}</Text></Pressable>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Surface({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  wordmark: { color: AREV.forest, fontSize: 16, fontWeight: "900", letterSpacing: 2.4 },
  iconBadge: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  primaryButton: { minHeight: 56, borderRadius: 18, paddingHorizontal: 20, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center", backgroundColor: AREV.lime },
  primaryText: { color: AREV.forest, fontSize: 16, fontWeight: "800" },
  secondaryButton: { minHeight: 48, borderRadius: 16, paddingHorizontal: 16, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: AREV.line, backgroundColor: AREV.white },
  secondaryText: { color: AREV.forest, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  sectionLabel: { color: AREV.cocoa, fontSize: 12, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  surface: { borderRadius: 24, padding: 18, backgroundColor: AREV.white, borderWidth: 1, borderColor: AREV.line },
});
