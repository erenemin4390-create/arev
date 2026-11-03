import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";

import { getDownloadFileUrl } from "@/lib/media/client";

export type ProgressCallback = (progress: number) => void;

function safeFilename(filename: string) {
  return filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 160) || `arev-${Date.now()}.bin`;
}

export async function downloadJobFile(
  jobId: string,
  filename: string,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<{ uri?: string; browserDownload: boolean }> {
  const { url, secret } = await getDownloadFileUrl(jobId);
  if (Platform.OS === "web") {
    const response = await fetch(url, { headers: { "x-arev-client": secret }, signal });
    if (!response.ok) throw new Error(`Dosya aktarımı başarısız (${response.status})`);
    const total = Number(response.headers.get("content-length") ?? 0);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader) {
      while (true) {
        if (signal.aborted) throw new DOMException("İptal edildi", "AbortError");
        const next = await reader.read();
        if (next.done) break;
        if (next.value) {
          chunks.push(next.value);
          received += next.value.byteLength;
          if (total) onProgress(received / total);
        }
      }
    } else {
      const blob = await response.blob();
      chunks.push(new Uint8Array(await blob.arrayBuffer()));
      received = chunks[0]?.byteLength ?? 0;
    }
    const blob = new Blob(chunks as BlobPart[]);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = safeFilename(filename);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    onProgress(1);
    return { browserDownload: true };
  }

  const root = FileSystem.documentDirectory;
  if (!root) throw new Error("Cihaz dosya alanı kullanılamıyor.");
  const directory = `${root}AREV/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}${safeFilename(filename)}`;
  const task = FileSystem.createDownloadResumable(
    url,
    target,
    { headers: { "x-arev-client": secret } },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) onProgress(totalBytesWritten / totalBytesExpectedToWrite);
    },
  );
  const abortTask = () => { void task.cancelAsync(); };
  signal.addEventListener("abort", abortTask, { once: true });
  const result = await task.downloadAsync();
  signal.removeEventListener("abort", abortTask);
  if (!result?.uri) throw new Error("İndirme tamamlanamadı.");
  onProgress(1);
  return { uri: result.uri, browserDownload: false };
}

export async function removePartialFile(uri?: string): Promise<void> {
  if (!uri || Platform.OS === "web") return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cleanup only.
  }
}

export async function verifyFile(uri: string): Promise<boolean> {
  if (Platform.OS === "web") return true;
  return (await FileSystem.getInfoAsync(uri)).exists;
}

export async function shareLocalFile(uri: string, mimeType: string): Promise<void> {
  if (!(await verifyFile(uri))) throw new Error("Dosya cihazda bulunamadı.");
  if (!(await Sharing.isAvailableAsync())) throw new Error("Bu cihazda paylaşım kullanılamıyor.");
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: "AREV dosyasını paylaş" });
}

export async function saveMediaToLibrary(uri: string, kind: "image" | "video"): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) return false;
  const asset = await MediaLibrary.createAssetAsync(uri);
  const album = await MediaLibrary.getAlbumAsync("AREV");
  if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
  else await MediaLibrary.createAlbumAsync("AREV", asset, false);
  return true;
}
