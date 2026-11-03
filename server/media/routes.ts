import type { Express, Request, Response } from "express";
import { createReadStream } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DownloadJob, MediaFormat, MediaInspection, MediaKind } from "../../shared/media";
import {
  INSPECTION_TTL_MS,
  JOB_TTL_MS,
  MAX_DURATION_SECONDS,
  MAX_FILE_BYTES,
  MediaSecurityError,
  isAllowedMediaExtension,
  isAllowedMediaMime,
  isSafeRelativeChild,
  ownerKeyFromRequest,
  parseSingleRange,
  requestAddress,
  safeDisplaySource,
  safeFilename,
  validateUrlSyntax,
} from "./security";
import {
  MediaWorkerError,
  PythonMediaWorker,
  type MediaWorker,
  type WorkerDownloadResult,
  type WorkerDownloadSpec,
  type WorkerFormat,
  type WorkerInspection,
} from "./worker";

export class MediaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaApiError";
  }
}

type InternalFormat = MediaFormat & {
  mode: "direct" | "yt";
  sourceUrl?: string;
  pageUrl?: string;
  selector?: string;
  postprocess?: "mp3";
};

type StoredInspection = {
  owner: string;
  expiresAt: number;
  inspection: MediaInspection;
  formats: Map<string, InternalFormat>;
};

type StoredJob = {
  owner: string;
  expiresAt: number;
  id: string;
  status: DownloadJob["status"];
  progress: number | null;
  message: string;
  inspectionId: string;
  format: InternalFormat;
  filename: string;
  outputDir: string;
  filePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  controller: AbortController;
  cancelRequested: boolean;
};

const ERROR_MESSAGES: Record<string, { status: number; message: string }> = {
  invalid_url: { status: 400, message: "Geçerli bir http/https bağlantısı girin." },
  private_url: { status: 400, message: "Bu bağlantıya güvenli ağ kısıtlamaları nedeniyle erişilemiyor." },
  client_required: { status: 401, message: "AREV istemci anahtarı gerekli." },
  invalid_request: { status: 400, message: "İstek bilgileri eksik veya geçersiz." },
  unsupported_media: { status: 415, message: "Bu medya biçimi desteklenmiyor." },
  protected_content: { status: 403, message: "Oturum, DRM, canlı veya yaklaşan içerik indirilemez." },
  source_blocked: { status: 403, message: "YouTube bu sunucudan ek doğrulama istiyor. AREV, hesap doğrulamasını veya platform korumasını aşamaz; videoyu YouTube Studio’dan indirip doğrudan medya dosyası olarak kullanın." },
  unsupported_source: { status: 415, message: "Bu kaynak desteklenmiyor." },
  media_not_found: { status: 404, message: "İndirilebilir medya bulunamadı." },
  size_limit: { status: 413, message: "Medya sunucunun güvenli 20 GB aktarım sınırını aşıyor." },
  duration_limit: { status: 413, message: "Medya sunucunun güvenli süre sınırını aşıyor." },
  rate_limited: { status: 429, message: "Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin." },
  inspection_not_found: { status: 404, message: "Medya incelemesi bulunamadı veya süresi doldu." },
  job_not_found: { status: 404, message: "İndirme işi bulunamadı." },
  format_not_found: { status: 400, message: "Seçilen kalite veya biçim artık kullanılamıyor." },
  worker_unavailable: { status: 503, message: "Medya hizmeti şu anda kullanılamıyor." },
  timeout: { status: 504, message: "Medya işlemi zaman aşımına uğradı." },
  download_failed: { status: 502, message: "Medya indirilemedi." },
  cancelled: { status: 409, message: "İndirme iptal edildi." },
};

const FALLBACK_ERROR = { status: 500, message: "Medya işlemi sırasında beklenmeyen bir hata oluştu." };

function apiError(code: string): MediaApiError {
  const mapped = ERROR_MESSAGES[code] ?? FALLBACK_ERROR;
  return new MediaApiError(mapped.status, code, mapped.message);
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof MediaApiError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof MediaSecurityError) {
    const mapped = ERROR_MESSAGES[error.code] ?? FALLBACK_ERROR;
    res.status(mapped.status).json({ error: mapped.message, code: error.code });
    return;
  }
  if (error instanceof MediaWorkerError) {
    const mapped = ERROR_MESSAGES[error.code] ?? FALLBACK_ERROR;
    res.status(mapped.status).json({ error: mapped.message, code: error.code });
    return;
  }
  res.status(500).json({ error: FALLBACK_ERROR.message, code: "internal_error" });
}

function validKind(value: unknown): value is MediaKind {
  return value === "video" || value === "audio" || value === "image";
}

function validWorkerFormat(value: WorkerFormat): boolean {
  return Boolean(
    value &&
      typeof value.key === "string" &&
      value.key.length > 0 &&
      (value.mode === "direct" || value.mode === "yt") &&
      isAllowedMediaExtension(value.ext) &&
      isAllowedMediaMime(value.mimeType) &&
      typeof value.hasAudio === "boolean" &&
      (value.sizeBytes === undefined || (Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0 && value.sizeBytes <= MAX_FILE_BYTES)) &&
      (value.height === undefined || (Number.isSafeInteger(value.height) && value.height > 0 && value.height <= 10000)),
  );
}

export function normalizeWorkerInspection(raw: WorkerInspection, originalUrl: string): {
  inspection: MediaInspection;
  formats: Map<string, InternalFormat>;
} {
  if (!raw || !validKind(raw.kind) || typeof raw.title !== "string" || !Array.isArray(raw.formats)) {
    throw apiError("unsupported_source");
  }
  if (raw.duration !== undefined && raw.duration !== null && (!Number.isFinite(raw.duration) || raw.duration < 0 || raw.duration > MAX_DURATION_SECONDS)) {
    throw apiError("duration_limit");
  }
  const formats = new Map<string, InternalFormat>();
  for (const candidate of raw.formats) {
    if (!validWorkerFormat(candidate) || formats.has(candidate.key)) continue;
    if (candidate.mode === "direct" && typeof candidate.sourceUrl !== "string") continue;
    if (candidate.mode === "direct") {
      try {
        validateUrlSyntax(candidate.sourceUrl);
      } catch {
        continue;
      }
    }
    if (candidate.mode === "yt" && (typeof candidate.selector !== "string" || candidate.selector.length === 0)) continue;
    const id = `f${formats.size + 1}`;
    const internal: InternalFormat = {
      id,
      label:
        candidate.label ||
        (candidate.height ? `${candidate.height}p ${candidate.ext.toUpperCase()}` : candidate.ext.toUpperCase()),
      height: candidate.height,
      ext: candidate.ext.toLowerCase(),
      mimeType: candidate.mimeType.split(";", 1)[0]!.toLowerCase(),
      hasAudio: candidate.hasAudio,
      sizeBytes: candidate.sizeBytes,
      mode: candidate.mode,
      sourceUrl: candidate.sourceUrl,
      pageUrl: candidate.mode === "yt" ? originalUrl : undefined,
      selector: candidate.selector,
      postprocess: candidate.postprocess,
    };
    formats.set(id, internal);
  }
  if (formats.size === 0) throw apiError("media_not_found");
  const inspectionId = randomUUID();
  const inspection: MediaInspection = {
    inspectionId,
    title: raw.title.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "AREV medya",
    source: safeDisplaySource(raw.sourceUrl || originalUrl),
    kind: raw.kind,
    duration: raw.duration ?? undefined,
    formats: [...formats.values()].map(({ mode: _mode, sourceUrl: _sourceUrl, pageUrl: _pageUrl, selector: _selector, postprocess: _postprocess, ...publicFormat }) => publicFormat),
  };
  return { inspection, formats };
}

class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  allow(key: string, limit: number, windowMs: number, now: number): boolean {
    const cutoff = now - windowMs;
    const fresh = (this.hits.get(key) ?? []).filter((stamp) => stamp > cutoff);
    if (fresh.length >= limit) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return true;
  }
}

type ScheduledTask = () => Promise<void>;
const downloadQueue: ScheduledTask[] = [];
let activeDownloads = 0;
function enqueueDownload(task: ScheduledTask): void {
  downloadQueue.push(task);
  queueMicrotask(pumpDownloads);
}
function pumpDownloads(): void {
  while (activeDownloads < 2 && downloadQueue.length > 0) {
    const task = downloadQueue.shift()!;
    activeDownloads += 1;
    void task().finally(() => {
      activeDownloads -= 1;
      pumpDownloads();
    });
  }
}

export type MediaServiceOptions = {
  worker?: MediaWorker;
  now?: () => number;
  tempRoot?: string;
};

export class MediaService {
  private readonly worker: MediaWorker;
  private readonly now: () => number;
  private readonly tempRoot: string;
  private readonly inspections = new Map<string, StoredInspection>();
  private readonly jobs = new Map<string, StoredJob>();
  private readonly limiter = new SlidingWindowLimiter();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(options: MediaServiceOptions = {}) {
    this.worker = options.worker ?? new PythonMediaWorker();
    this.now = options.now ?? Date.now;
    this.tempRoot = options.tempRoot ?? path.join(os.tmpdir(), "arev-media");
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), 60_000);
    this.cleanupTimer.unref();
  }

  async inspect(owner: string, address: string, value: unknown): Promise<MediaInspection> {
    if (!this.limiter.allow(`inspect:${owner}:${address}`, 10, 60_000, this.now())) throw apiError("rate_limited");
    const url = validateUrlSyntax(value);
    let raw: WorkerInspection;
    try {
      raw = await this.worker.inspect(url.toString());
    } catch (error) {
      throw error instanceof MediaWorkerError ? error : apiError("worker_unavailable");
    }
    const normalized = normalizeWorkerInspection(raw, url.toString());
    this.inspections.set(normalized.inspection.inspectionId, {
      owner,
      expiresAt: this.now() + INSPECTION_TTL_MS,
      ...normalized,
    });
    return normalized.inspection;
  }

  async createJob(owner: string, address: string, inspectionId: unknown, formatId: unknown): Promise<DownloadJob> {
    if (!this.limiter.allow(`job:${owner}:${address}`, 20, 60_000, this.now())) throw apiError("rate_limited");
    if (typeof inspectionId !== "string" || typeof formatId !== "string") throw apiError("invalid_request");
    const inspection = this.inspections.get(inspectionId);
    if (!inspection || inspection.expiresAt <= this.now() || inspection.owner !== owner) throw apiError("inspection_not_found");
    const format = inspection.formats.get(formatId);
    if (!format) throw apiError("format_not_found");
    const id = randomUUID();
    const outputDir = path.join(this.tempRoot, id);
    const job: StoredJob = {
      owner,
      expiresAt: this.now() + JOB_TTL_MS,
      id,
      status: "queued",
      progress: null,
      message: "İndirme sıraya alındı.",
      inspectionId,
      format,
      filename: safeFilename(inspection.inspection.title, format.ext),
      outputDir,
      controller: new AbortController(),
      cancelRequested: false,
    };
    this.jobs.set(id, job);
    enqueueDownload(() => this.runJob(job));
    return this.publicJob(job);
  }

  getJob(owner: string, id: string): DownloadJob {
    const job = this.jobs.get(id);
    if (!job || job.expiresAt <= this.now() || job.owner !== owner) throw apiError("job_not_found");
    return this.publicJob(job);
  }

  async cancelJob(owner: string, id: string): Promise<DownloadJob> {
    const job = this.jobs.get(id);
    if (!job || job.expiresAt <= this.now() || job.owner !== owner) throw apiError("job_not_found");
    job.cancelRequested = true;
    job.controller.abort();
    if (job.status !== "ready" && job.status !== "error") {
      job.status = "cancelled";
      job.progress = null;
      job.message = "İndirme iptal edildi.";
    }
    if (job.status === "ready" || job.status === "error") await this.removeJobFiles(job);
    job.status = "cancelled";
    job.progress = null;
    job.message = "İndirme iptal edildi.";
    return this.publicJob(job);
  }

  async sendFile(owner: string, id: string, req: Request, res: Response): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || job.expiresAt <= this.now() || job.owner !== owner || job.status !== "ready" || !job.filePath) throw apiError("job_not_found");
    const filePath = path.resolve(job.filePath);
    const dir = path.resolve(job.outputDir);
    if (!isSafeRelativeChild(dir, filePath)) throw apiError("job_not_found");
    let fileStat;
    try {
      fileStat = await stat(filePath);
      await access(filePath, fsConstants.R_OK);
    } catch {
      throw apiError("job_not_found");
    }
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_FILE_BYTES) throw apiError("job_not_found");
    const total = fileStat.size;
    let range: { start: number; end: number } | null = null;
    try {
      range = parseSingleRange(req.headers.range, total);
    } catch {
      res.status(416).set("Content-Range", `bytes */${total}`).end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? total - 1;
    res.status(range ? 206 : 200);
    res.setHeader("Content-Type", job.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(end - start + 1));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(job.filename)}`);
    if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    createReadStream(filePath, { start, end }).on("error", () => undefined).pipe(res);
  }

  private publicJob(job: StoredJob): DownloadJob {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      ...(job.status === "ready"
        ? {
            filename: job.filename,
            mimeType: job.mimeType,
            sizeBytes: job.sizeBytes,
            downloadPath: `/api/media/jobs/${job.id}/file`,
          }
        : {}),
    };
  }

  private async runJob(job: StoredJob): Promise<void> {
    if (job.cancelRequested || job.status === "cancelled") return;
    job.status = "preparing";
    job.message = "Medya hazırlanıyor.";
    const spec: WorkerDownloadSpec = {
      mode: job.format.mode,
      url: job.format.mode === "direct" ? job.format.sourceUrl : undefined,
      pageUrl: job.format.mode === "yt" ? job.format.pageUrl : undefined,
      selector: job.format.selector,
      ext: job.format.ext,
      mimeType: job.format.mimeType,
      postprocess: job.format.postprocess,
    };
    try {
      await mkdir(job.outputDir, { recursive: true });
      const result = await this.worker.download(spec, job.outputDir, (percent) => {
        if (job.cancelRequested) return;
        job.status = "downloading";
        job.message = "Medya indiriliyor.";
        job.progress = percent === null ? null : Math.max(0, Math.min(1, percent / 100));
      }, job.controller.signal);
      if (job.cancelRequested) return;
      const fileName = path.basename(result.fileName);
      const filePath = path.resolve(job.outputDir, fileName);
      if (fileName !== result.fileName || !isSafeRelativeChild(path.resolve(job.outputDir), filePath)) throw apiError("download_failed");
      const fileStat = await stat(filePath);
      await access(filePath, fsConstants.R_OK);
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_FILE_BYTES || !isAllowedMediaExtension(path.extname(fileName))) throw apiError("download_failed");
      if (fileStat.size !== result.sizeBytes || !isAllowedMediaMime(result.mimeType)) throw apiError("download_failed");
      job.filePath = filePath;
      job.mimeType = result.mimeType.split(";", 1)[0]!.toLowerCase();
      job.sizeBytes = fileStat.size;
      job.progress = 1;
      job.status = "ready";
      job.message = "İndirme tamamlandı.";
    } catch (error) {
      if (job.cancelRequested || (error instanceof MediaWorkerError && error.code === "cancelled")) {
        job.status = "cancelled";
        job.progress = null;
        job.message = "İndirme iptal edildi.";
      } else {
        const code = error instanceof MediaApiError ? error.code : error instanceof MediaWorkerError ? error.code : "download_failed";
        job.status = "error";
        job.progress = null;
        job.message = ERROR_MESSAGES[code]?.message ?? ERROR_MESSAGES.download_failed.message;
      }
      await this.removeJobFiles(job);
    }
  }

  private async removeJobFiles(job: StoredJob): Promise<void> {
    await rm(job.outputDir, { recursive: true, force: true }).catch(() => undefined);
    job.filePath = undefined;
    job.sizeBytes = undefined;
    job.mimeType = undefined;
  }

  private async cleanupExpired(): Promise<void> {
    const now = this.now();
    for (const [id, job] of this.jobs) {
      if (job.expiresAt <= now) {
        job.cancelRequested = true;
        job.controller.abort();
        await this.removeJobFiles(job);
        this.jobs.delete(id);
      }
    }
    for (const [id, inspection] of this.inspections) {
      if (inspection.expiresAt <= now) this.inspections.delete(id);
    }
  }
}

export function registerMediaRoutes(app: Express, options: MediaServiceOptions = {}): MediaService {
  const service = new MediaService(options);
  const owner = (req: Request): string => ownerKeyFromRequest(req);
  const address = (req: Request): string => requestAddress(req);
  const asyncRoute = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => {
    void handler(req, res).catch((error) => sendError(res, error));
  };

  app.post(
    "/api/media/inspect",
    asyncRoute(async (req, res) => {
      const clientOwner = owner(req);
      res.json(await service.inspect(clientOwner, address(req), req.body?.url));
    }),
  );
  app.post(
    "/api/media/jobs",
    asyncRoute(async (req, res) => {
      const clientOwner = owner(req);
      res.status(202).json(await service.createJob(clientOwner, address(req), req.body?.inspectionId, req.body?.formatId));
    }),
  );
  app.get(
    "/api/media/jobs/:id/file",
    asyncRoute(async (req, res) => {
      await service.sendFile(owner(req), req.params.id, req, res);
    }),
  );
  app.get(
    "/api/media/jobs/:id",
    asyncRoute(async (req, res) => {
      res.json(service.getJob(owner(req), req.params.id));
    }),
  );
  app.delete(
    "/api/media/jobs/:id",
    asyncRoute(async (req, res) => {
      res.json(await service.cancelJob(owner(req), req.params.id));
    }),
  );
  return service;
}
