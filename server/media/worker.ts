import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

export type WorkerFormat = {
  key: string;
  mode: "direct" | "yt";
  ext: string;
  mimeType: string;
  label?: string;
  hasAudio: boolean;
  sizeBytes?: number;
  height?: number;
  selector?: string;
  postprocess?: "mp3";
  sourceUrl?: string;
};

export type WorkerInspection = {
  kind: "video" | "audio" | "image";
  title: string;
  sourceUrl: string;
  duration?: number | null;
  formats: WorkerFormat[];
};

export type WorkerDownloadSpec = {
  mode: "direct" | "yt";
  url?: string;
  pageUrl?: string;
  selector?: string;
  ext: string;
  mimeType: string;
  postprocess?: "mp3";
};

export type WorkerDownloadResult = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  duration?: number | null;
};

export class MediaWorkerError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MediaWorkerError";
  }
}

export interface MediaWorker {
  inspect(url: string, signal?: AbortSignal): Promise<WorkerInspection>;
  download(
    spec: WorkerDownloadSpec,
    outputDir: string,
    onProgress: (percent: number | null) => void,
    signal?: AbortSignal,
  ): Promise<WorkerDownloadResult>;
}

type WorkerResponse = {
  ok?: boolean;
  result?: WorkerInspection | WorkerDownloadResult;
  error?: { code?: string };
  event?: string;
  percent?: number | null;
};

function defaultScriptPath(): string {
  const candidates = [
    process.env.AREV_MEDIA_WORKER_PATH,
    path.join(process.cwd(), "server/media/media_worker.py"),
    path.join(process.cwd(), "dist/media_worker.py"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "media_worker.py"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function defaultPythonCommand(): string {
  return process.env.AREV_MEDIA_PYTHON || "python3";
}

export class PythonMediaWorker implements MediaWorker {
  constructor(
    private readonly pythonCommand = defaultPythonCommand(),
    private readonly scriptPath = defaultScriptPath(),
    private readonly inspectTimeoutMs = 3 * 60 * 1000,
    private readonly downloadTimeoutMs = 35 * 60 * 1000,
  ) {}

  inspect(url: string, signal?: AbortSignal): Promise<WorkerInspection> {
    return this.run<WorkerInspection>({ command: "inspect", url }, this.inspectTimeoutMs, undefined, signal);
  }

  download(
    spec: WorkerDownloadSpec,
    outputDir: string,
    onProgress: (percent: number | null) => void,
    signal?: AbortSignal,
  ): Promise<WorkerDownloadResult> {
    return this.run<WorkerDownloadResult>(
      { command: "download", spec, outputDir },
      this.downloadTimeoutMs,
      onProgress,
      signal,
    );
  }

  private run<T>(
    request: Record<string, unknown>,
    timeoutMs: number,
    onProgress: ((percent: number | null) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let child: ChildProcessByStdio<Writable, Readable, null>;
      try {
        child = spawn(this.pythonCommand, ["-u", this.scriptPath], {
          stdio: ["pipe", "pipe", "ignore"],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
          },
        });
      } catch {
        reject(new MediaWorkerError("worker_unavailable"));
        return;
      }

      let settled = false;
      let buffer = "";
      let timer: NodeJS.Timeout | undefined;
      let abortTimer: NodeJS.Timeout | undefined;

      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (abortTimer) clearTimeout(abortTimer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value as T);
      };
      const stop = () => {
        if (settled) return;
        child.kill("SIGTERM");
        abortTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        finish(new MediaWorkerError("cancelled"));
      };
      const abort = () => stop();

      const consume = (line: string) => {
        let payload: WorkerResponse;
        try {
          payload = JSON.parse(line) as WorkerResponse;
        } catch {
          return;
        }
        if (payload.event === "progress" && onProgress) {
          const value = payload.percent;
          onProgress(typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null);
          return;
        }
        if (payload.ok && payload.result) {
          finish(undefined, payload.result as T);
          child.kill("SIGTERM");
          return;
        }
        if (payload.ok === false) {
          finish(new MediaWorkerError(payload.error?.code || "worker_unavailable"));
        }
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString();
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) consume(line);
          index = buffer.indexOf("\n");
        }
      });
      child.on("error", () => finish(new MediaWorkerError("worker_unavailable")));
      child.on("close", (code) => {
        if (settled) return;
        if (buffer.trim()) consume(buffer.trim());
        if (!settled) finish(new MediaWorkerError(code === 0 ? "worker_unavailable" : "download_failed"));
      });

      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new MediaWorkerError("timeout"));
      }, timeoutMs);
      timer.unref();
      if (signal?.aborted) {
        stop();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}
