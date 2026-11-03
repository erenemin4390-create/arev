import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useIncomingShare } from "expo-sharing";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { AREV, IconBadge, PrimaryButton, SectionLabel, SecondaryButton, Surface, Wordmark } from "@/components/arev/ui";
import { useMediaDownload } from "@/hooks/arev/use-media-download";
import { usePwaInstall } from "@/hooks/arev/use-pwa-install";

const SAMPLE_URL = "https://filesamples.com/samples/video/mp4/sample_640x360.mp4";

function formatBytes(value?: number) {
  if (!value) return "Boyut backend’den gelecek";
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function NativeShareBridge({ busy, onIncoming }: { busy: boolean; onIncoming: (value: string) => void }) {
  const { sharedPayloads, clearSharedPayloads } = useIncomingShare();
  useEffect(() => {
    const incoming = sharedPayloads.find((payload) => (payload.shareType === "url" || payload.shareType === "text") && /^https?:\/\//i.test(payload.value.trim()))?.value.trim();
    if (!incoming) return;
    clearSharedPayloads();
    onIncoming(incoming);
  }, [busy, clearSharedPayloads, onIncoming, sharedPayloads]);
  return null;
}

export default function DownloadScreen() {
  const [url, setUrl] = useState("");
  const [pendingShare, setPendingShare] = useState("");
  const flow = useMediaDownload();
  const { inspect: inspectUrl } = flow;
  const { canInstall, promptInstall } = usePwaInstall();
  const busy = flow.stage === "inspecting" || flow.stage === "preparing" || flow.stage === "transferring";
  const handleIncomingShare = useCallback((incoming: string) => {
    if (busy) setPendingShare(incoming);
    else { setUrl(incoming); void inspectUrl(incoming); }
  }, [busy, inspectUrl]);

  const selectedHint = useMemo(() => flow.inspection?.formats.length ? "Gerçek kaynak seçenekleri" : "Format bilgisi bekleniyor", [flow.inspection]);

  async function paste() {
    const value = await Clipboard.getStringAsync();
    if (value) setUrl(value.trim());
  }

  function inspect() { void flow.inspect(url); }

  return (
    <>
      {Platform.OS !== "web" ? <NativeShareBridge busy={busy} onIncoming={handleIncomingShare} /> : null}
      <ScreenContainer containerClassName="bg-[#FCFAF2]" safeAreaClassName="bg-[#FCFAF2]" edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.topline}><Wordmark /><View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>{Platform.OS === "web" && canInstall ? <Pressable accessibilityRole="button" onPress={() => void promptInstall()} style={{ flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 99, backgroundColor: AREV.lime, paddingVertical: 7, paddingHorizontal: 10 }}><Ionicons name="download-outline" size={15} color={AREV.forest} /><Text style={{ color: AREV.forest, fontSize: 11, fontWeight: "900" }}>AREV’yi yükle</Text></Pressable> : null}<View style={styles.privacyPill}><View style={styles.dot} /><Text style={styles.privacyText}>Özel akış</Text></View></View></View>
          <View style={styles.heroRow}>
            <View style={styles.heroCopy}><Text style={styles.eyebrow}>LINK → DOSYA</Text><Text style={styles.heroTitle}>Bir link.{"\n"}Cebinde bir dosya.</Text><Text style={styles.heroSub}>Açık ve herkese erişilebilir medyayı gerçek kalitesiyle incele, cihazına al.</Text></View>
            <IconBadge name="leaf" />
          </View>

          {pendingShare ? <Surface style={styles.pending}><Ionicons name="share-outline" size={20} color={AREV.cocoa} /><View style={styles.pendingCopy}><Text style={styles.pendingTitle}>Yeni bir bağlantı bekliyor</Text><Text style={styles.pendingText} numberOfLines={1}>{pendingShare}</Text></View><Pressable accessibilityRole="button" onPress={() => { setUrl(pendingShare); setPendingShare(""); void flow.inspect(pendingShare); }}><Text style={styles.pendingAction}>Kullan</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setPendingShare("")}><Ionicons name="close" size={20} color={AREV.muted} /></Pressable></Surface> : null}

          <Surface style={styles.inputCard}>
            <View style={styles.inputHeader}><SectionLabel>Kaynak bağlantısı</SectionLabel><Pressable onPress={() => setUrl(SAMPLE_URL)} accessibilityRole="button"><Text style={styles.sample}>Örnek bağlantı</Text></Pressable></View>
            <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" multiline numberOfLines={3} placeholder="https://..." placeholderTextColor="#A1A99C" style={styles.input} accessibilityLabel="Medya bağlantısı" />
            <View style={styles.inputFooter}><Text style={styles.helper}>Yalnızca açık, herkese erişilebilir medya.</Text><Pressable onPress={() => void paste()} accessibilityRole="button" style={styles.paste}><Ionicons name="clipboard-outline" size={16} color={AREV.forest} /><Text style={styles.pasteText}>Yapıştır</Text></Pressable></View>
            <PrimaryButton onPress={inspect} disabled={!url.trim() || busy} loading={flow.stage === "inspecting"} icon="arrow-forward">Bağlantıyı incele</PrimaryButton>
          </Surface>

          {flow.error ? <Surface style={styles.error}><Ionicons name="warning-outline" size={20} color={AREV.error} /><Text style={styles.errorText}>{flow.error}</Text></Surface> : null}

          {flow.inspection ? <Surface style={styles.inspection}>
            <View style={styles.inspectionTop}><View style={styles.kindIcon}><Ionicons name={flow.inspection.kind === "video" ? "videocam" : flow.inspection.kind === "audio" ? "musical-notes" : "image"} size={21} color={AREV.forest} /></View><View style={styles.inspectionCopy}><Text style={styles.inspectionTitle} numberOfLines={2}>{flow.inspection.title}</Text><Text style={styles.inspectionMeta}>{flow.inspection.kind.toUpperCase()} · {flow.inspection.duration ? `${Math.round(flow.inspection.duration)} sn` : "Süre kaynakta"}</Text></View></View>
            <View style={styles.rule} /><Text style={styles.formatHeading}>Kalite ve format <Text style={styles.formatHint}>· {selectedHint}</Text></Text>
            {flow.inspection.formats.map((format) => <Pressable key={format.id} accessibilityRole="button" disabled={busy} onPress={() => void flow.download(format)} style={({ pressed }) => [styles.formatRow, pressed && styles.pressed]}><View><Text style={styles.formatLabel}>{format.label}</Text><Text style={styles.formatMeta}>{format.ext.toUpperCase()} · {format.mimeType} · {formatBytes(format.sizeBytes)}</Text></View><Ionicons name="download-outline" size={20} color={AREV.forest} /></Pressable>)}
            {flow.inspection.formats.length === 0 ? <Text style={styles.emptyText}>Bu kaynak için indirilebilir gerçek format bulunamadı.</Text> : null}
          </Surface> : null}

          {busy ? <Surface style={styles.progressCard}><View style={styles.progressHeader}><Text style={styles.progressStage}>{flow.message || "Aktarılıyor"}</Text><Text style={styles.progressPercent}>{Math.round(flow.progress * 100)}%</Text></View><View style={styles.track}><View style={[styles.trackFill, { width: `${Math.max(3, flow.progress * 100)}%` }]} /></View><SecondaryButton onPress={() => void flow.cancel()} icon="close-circle-outline">İndirmeyi iptal et</SecondaryButton></Surface> : null}
          {flow.stage === "done" ? <Surface style={styles.done}><Ionicons name="checkmark-circle" size={24} color={AREV.forest} /><View style={styles.doneCopy}><Text style={styles.doneTitle}>Dosya hazır</Text><Text style={styles.doneText}>{flow.message}. Dosyalar sekmesinden açabilir veya paylaşabilirsin.</Text></View></Surface> : null}

          <View style={styles.note}><Ionicons name="shield-checkmark-outline" size={17} color={AREV.cocoa} /><Text style={styles.noteText}>AREV yalnızca public medya ile çalışır. İndirme sırasında uygulamayı önde tut; erişim ve kaynak kısıtları siteye göre değişebilir.</Text></View>
        </ScrollView>
      </KeyboardAvoidingView>
      </ScreenContainer>
    </>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, content: { width: "100%", maxWidth: 540, alignSelf: "center", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36, gap: 16 }, topline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, privacyPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 99, backgroundColor: "#F0F5E4", paddingVertical: 7, paddingHorizontal: 10 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: AREV.cocoa }, privacyText: { color: AREV.cocoa, fontSize: 12, fontWeight: "800" }, heroRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingTop: 12, paddingBottom: 6 }, heroCopy: { flex: 1, paddingRight: 20 }, eyebrow: { color: AREV.cocoa, fontSize: 12, fontWeight: "900", letterSpacing: 1.6, marginBottom: 10 }, heroTitle: { color: AREV.forest, fontSize: 39, lineHeight: 42, fontWeight: "900", letterSpacing: -1.5 }, heroSub: { color: AREV.muted, fontSize: 15, lineHeight: 22, marginTop: 12, maxWidth: 350 }, inputCard: { gap: 14 }, inputHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, sample: { color: AREV.forest, fontSize: 12, fontWeight: "800" }, input: { minHeight: 92, borderRadius: 16, borderWidth: 1, borderColor: AREV.line, backgroundColor: AREV.cream, color: AREV.ink, fontSize: 16, lineHeight: 23, paddingHorizontal: 14, paddingVertical: 13, textAlignVertical: "top" }, inputFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, helper: { color: AREV.muted, fontSize: 12, flex: 1 }, paste: { flexDirection: "row", gap: 5, alignItems: "center", padding: 4 }, pasteText: { color: AREV.forest, fontSize: 12, fontWeight: "900" }, error: { flexDirection: "row", gap: 10, alignItems: "flex-start", borderColor: "#EBC8BE", backgroundColor: "#FFF5F1" }, errorText: { color: AREV.error, lineHeight: 20, flex: 1, fontSize: 14 }, inspection: { gap: 14 }, inspectionTop: { flexDirection: "row", gap: 12, alignItems: "center" }, kindIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: AREV.lime, alignItems: "center", justifyContent: "center" }, inspectionCopy: { flex: 1 }, inspectionTitle: { color: AREV.ink, fontSize: 17, fontWeight: "900", lineHeight: 22 }, inspectionMeta: { color: AREV.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, marginTop: 3 }, rule: { height: 1, backgroundColor: AREV.line }, formatHeading: { color: AREV.ink, fontSize: 14, fontWeight: "900" }, formatHint: { color: AREV.muted, fontWeight: "600" }, formatRow: { minHeight: 58, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: AREV.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, formatLabel: { color: AREV.forest, fontSize: 14, fontWeight: "900" }, formatMeta: { color: AREV.muted, fontSize: 11, marginTop: 3, maxWidth: 285 }, emptyText: { color: AREV.muted, fontSize: 13, lineHeight: 19 }, progressCard: { gap: 14 }, progressHeader: { flexDirection: "row", justifyContent: "space-between" }, progressStage: { color: AREV.forest, fontSize: 14, fontWeight: "900" }, progressPercent: { color: AREV.cocoa, fontSize: 14, fontWeight: "900" }, track: { height: 9, borderRadius: 6, backgroundColor: "#ECF0E2", overflow: "hidden" }, trackFill: { height: "100%", borderRadius: 6, backgroundColor: AREV.lime }, done: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: "#F0F5E4", borderColor: "#D8E7B6" }, doneCopy: { flex: 1 }, doneTitle: { color: AREV.forest, fontSize: 15, fontWeight: "900" }, doneText: { color: AREV.muted, fontSize: 13, lineHeight: 19, marginTop: 3 }, note: { flexDirection: "row", gap: 8, alignItems: "flex-start", paddingVertical: 5, paddingHorizontal: 3 }, noteText: { color: AREV.muted, fontSize: 12, lineHeight: 18, flex: 1 }, pending: { flexDirection: "row", gap: 9, alignItems: "center", padding: 12, backgroundColor: "#FFF5E8", borderColor: "#F1D9B9" }, pendingCopy: { flex: 1 }, pendingTitle: { color: AREV.cocoa, fontSize: 12, fontWeight: "900" }, pendingText: { color: AREV.muted, fontSize: 11, marginTop: 2 }, pendingAction: { color: AREV.forest, fontWeight: "900", fontSize: 12 }, pressed: { opacity: 0.72 },
});
