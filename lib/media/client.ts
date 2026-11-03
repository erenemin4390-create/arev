import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import { getApiBaseUrl } from "@/constants/oauth";
import type { ApiError, DownloadJob, MediaInspection } from "@shared/media";

export const CLIENT_SECRET_KEY = "arev.installation-secret.v1";
export const API_OVERRIDE_KEY = "arev.api-base-url.v1";
export const HISTORY_KEY = "arev.download-history.v1";

export type DownloadRecord = {
  id: string;
  title: string;
  filename: string;
  kind: string;
  mimeType: string;
  sizeBytes?: number;
  savedUri?: string;
  createdAt: string;
};

export async function getInstallationSecret(): Promise<string> {
  const existing = await AsyncStorage.getItem(CLIENT_SECRET_KEY);
  if (existing) return existing;
  const secret = Crypto.randomUUID();
  await AsyncStorage.setItem(CLIENT_SECRET_KEY, secret);
  return secret;
}

export async function getApiOverride(): Promise<string> {
  return (await AsyncStorage.getItem(API_OVERRIDE_KEY)) ?? "";
}

export async function setApiOverride(value: string): Promise<void> {
  const trimmed = value.trim().replace(/\/$/, "");
  if (trimmed && !/^https:\/\//i.test(trimmed)) {
    throw new Error("Native API adresi HTTPS olmalı.");
  }
  if (trimmed) await AsyncStorage.setItem(API_OVERRIDE_KEY, trimmed);
  else await AsyncStorage.removeItem(API_OVERRIDE_KEY);
}

export async function resolveApiBaseUrl(): Promise<string> {
  const override = await getApiOverride();
  return override || getApiBaseUrl();
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = await resolveApiBaseUrl();
  if (!base && typeof window === "undefined") {
    throw new Error("API yapılandırması eksik. Ayarlar’dan güvenli bir HTTPS adresi ekleyin.");
  }
  const secret = await getInstallationSecret();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-arev-client": secret,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `Sunucu hatası (${response.status})`;
    try {
      const body = (await response.json()) as ApiError;
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function inspectMedia(url: string, signal?: AbortSignal) {
  return apiRequest<MediaInspection>("/api/media/inspect", {
    method: "POST",
    body: JSON.stringify({ url }),
    signal,
  });
}

export function createDownloadJob(inspectionId: string, formatId: string, signal?: AbortSignal) {
  return apiRequest<DownloadJob>("/api/media/jobs", {
    method: "POST",
    body: JSON.stringify({ inspectionId, formatId }),
    signal,
  });
}

export function getDownloadJob(id: string, signal?: AbortSignal) {
  return apiRequest<DownloadJob>(`/api/media/jobs/${encodeURIComponent(id)}`, { signal });
}

export function cancelDownloadJob(id: string) {
  return apiRequest<DownloadJob>(`/api/media/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getDownloadFileUrl(id: string): Promise<{ url: string; secret: string }> {
  const base = await resolveApiBaseUrl();
  return { url: `${base}/api/media/jobs/${encodeURIComponent(id)}/file`, secret: await getInstallationSecret() };
}

export async function readHistory(): Promise<DownloadRecord[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(HISTORY_KEY)) ?? "[]") as DownloadRecord[];
  } catch {
    return [];
  }
}

export async function addHistory(record: DownloadRecord): Promise<void> {
  const current = await readHistory();
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify([record, ...current].slice(0, 50)));
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}
