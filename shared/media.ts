export type MediaKind = "video" | "audio" | "image";
export interface MediaFormat {
  id: string;
  label: string;
  height?: number;
  ext: string;
  mimeType: string;
  hasAudio: boolean;
  sizeBytes?: number;
}
export interface MediaInspection {
  inspectionId: string;
  title: string;
  source: string;
  thumbnail?: string;
  kind: MediaKind;
  duration?: number;
  formats: MediaFormat[];
}
export type DownloadStatus = "queued" | "preparing" | "downloading" | "ready" | "cancelled" | "error";
export interface DownloadJob {
  id: string;
  status: DownloadStatus;
  progress: number | null;
  message: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  downloadPath?: string;
}
export interface ApiError { error: string; code?: string; }
// All /api/media requests require x-arev-client: a random installation secret.
// POST /api/media/inspect { url } -> MediaInspection
// POST /api/media/jobs { inspectionId, formatId } -> DownloadJob
// GET /api/media/jobs/:id -> DownloadJob
// DELETE /api/media/jobs/:id -> DownloadJob
// GET /api/media/jobs/:id/file -> media bytes (same x-arev-client required)
