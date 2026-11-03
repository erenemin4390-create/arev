import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadJob, MediaFormat, MediaInspection } from "@shared/media";

import { addHistory, cancelDownloadJob, createDownloadJob, getDownloadJob, inspectMedia } from "@/lib/media/client";
import { downloadJobFile, removePartialFile } from "@/lib/media/download";

export type DownloadStage = "idle" | "inspecting" | "preparing" | "transferring" | "done" | "error";

export function useMediaDownload() {
  const [inspection, setInspection] = useState<MediaInspection | null>(null);
  const [stage, setStage] = useState<DownloadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const revision = useRef(0);
  const inspectAbort = useRef<AbortController | null>(null);
  const transferAbort = useRef<AbortController | null>(null);
  const activeJob = useRef<string | null>(null);
  const partialUri = useRef<string | undefined>(undefined);

  const inspect = useCallback(async (url: string) => {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      setError("Güvenli bir http(s) bağlantısı yapıştırın.");
      return null;
    }
    const current = ++revision.current;
    inspectAbort.current?.abort();
    const controller = new AbortController();
    inspectAbort.current = controller;
    setInspection(null);
    setError("");
    setStage("inspecting");
    setMessage("Kaynak hazırlanıyor");
    try {
      const result = await inspectMedia(clean, controller.signal);
      if (current !== revision.current) return null;
      setInspection(result);
      setStage("idle");
      setMessage("");
      return result;
    } catch (cause) {
      if (controller.signal.aborted || current !== revision.current) return null;
      setStage("error");
      setError(cause instanceof Error ? cause.message : "Bağlantı incelenemedi.");
      return null;
    }
  }, []);

  const download = useCallback(async (format: MediaFormat) => {
    if (!inspection) return;
    const current = ++revision.current;
    const controller = new AbortController();
    transferAbort.current = controller;
    setError("");
    setProgress(0);
    setStage("preparing");
    setMessage("Kaynak hazırlanıyor");
    try {
      const created = await createDownloadJob(inspection.inspectionId, format.id, controller.signal);
      activeJob.current = created.id;
      let job: DownloadJob = created;
      for (let attempt = 0; attempt < 600 && !controller.signal.aborted; attempt += 1) {
        if (job.status === "ready") break;
        if (job.status === "error" || job.status === "cancelled") throw new Error(job.message || "Sunucu indirmeyi tamamlayamadı.");
        await new Promise((resolve) => setTimeout(resolve, 700));
        job = await getDownloadJob(created.id, controller.signal);
        if (current !== revision.current) return;
        if (job.progress != null) setProgress(Math.min(0.45, job.progress * 0.45));
        setMessage(job.message || "Kaynak hazırlanıyor");
      }
      if (controller.signal.aborted) return;
      if (job.status !== "ready") throw new Error("Sunucu hazırlığı zaman aşımına uğradı.");
      setStage("transferring");
      setMessage("Cihaza aktarılıyor");
      const result = await downloadJobFile(created.id, job.filename || `arev.${format.ext}`, (value) => {
        if (current === revision.current) setProgress(0.45 + value * 0.55);
      }, controller.signal);
      partialUri.current = result.uri;
      if (current !== revision.current) return;
      await addHistory({ id: created.id, title: inspection.title, filename: job.filename || `arev.${format.ext}`, kind: inspection.kind, mimeType: job.mimeType || format.mimeType, sizeBytes: job.sizeBytes, savedUri: result.uri, createdAt: new Date().toISOString() });
      setProgress(1);
      setStage("done");
      setMessage(result.browserDownload ? "Tarayıcı indirmeyi başlattı" : "Dosya AREV klasörüne kaydedildi");
    } catch (cause) {
      if (controller.signal.aborted || current !== revision.current) return;
      setStage("error");
      setError(cause instanceof Error ? cause.message : "İndirme başarısız oldu.");
    }
  }, [inspection]);

  const cancel = useCallback(async () => {
    revision.current += 1;
    transferAbort.current?.abort();
    inspectAbort.current?.abort();
    const jobId = activeJob.current;
    activeJob.current = null;
    await removePartialFile(partialUri.current);
    partialUri.current = undefined;
    if (jobId) {
      try { await cancelDownloadJob(jobId); } catch { /* server cleanup is best effort */ }
    }
    setStage("idle");
    setProgress(0);
    setMessage("");
  }, []);

  useEffect(() => () => { void cancel(); }, [cancel]);

  return { inspection, stage, progress, message, error, inspect, download, cancel, setError };
}
