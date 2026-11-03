import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { isPublicIp, parseSingleRange, validateUrlSyntax } from "../server/media/security";
import { MediaService, registerMediaRoutes } from "../server/media/routes";
import { MediaWorkerError, type MediaWorker, type WorkerDownloadSpec, type WorkerInspection, type WorkerDownloadResult } from "../server/media/worker";

class MockWorker implements MediaWorker {
  inspectError?: Error;
  inspectResult: WorkerInspection = {
    kind: "video",
    title: "örnek video",
    sourceUrl: "https://media.example.test/video.mp4?token=secret",
    formats: [
      {
        key: "real-720",
        mode: "direct",
        sourceUrl: "https://media.example.test/video.mp4?token=secret",
        ext: "mp4",
        mimeType: "video/mp4",
        hasAudio: true,
        height: 720,
        sizeBytes: 1024,
        label: "720p MP4",
      },
    ],
  };

  async inspect(): Promise<WorkerInspection> {
    if (this.inspectError) throw this.inspectError;
    return this.inspectResult;
  }

  async download(spec: WorkerDownloadSpec, outputDir: string): Promise<WorkerDownloadResult> {
    await mkdir(outputDir, { recursive: true });
    const fileName = `media.${spec.ext}`;
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, Buffer.from("deterministic-media"));
    return { fileName, mimeType: spec.mimeType, sizeBytes: Buffer.byteLength("deterministic-media") };
  }
}

describe("media URL and SSRF input policy", () => {
  it.each([
    "file:///etc/passwd",
    "http://127.0.0.1/video.mp4",
    "http://[::1]/video.mp4",
    "https://user:pass@example.com/video.mp4",
    "https://example.com:8443/video.mp4",
    "https://app.localhost/video.mp4",
  ])("rejects unsafe URL %s", (value) => {
    expect(() => validateUrlSyntax(value)).toThrow();
  });

  it("rejects special-use IPs while allowing a public literal", () => {
    expect(isPublicIp("10.0.0.5")).toBe(false);
    expect(isPublicIp("169.254.10.2")).toBe(false);
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("8.8.8.8")).toBe(true);
  });

  it("parses only a single bounded byte range", () => {
    expect(parseSingleRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseSingleRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(() => parseSingleRange("bytes=0-1,5-6", 100)).toThrow();
  });
});

describe("media route ownership and real format metadata", () => {
  let server: Server | undefined;
  let tempRoot: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
      server = undefined;
    }
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it("does not reveal inspections across installation secrets and does not invent formats", async () => {
    const app = express();
    app.use(express.json());
    tempRoot = path.join("/tmp", `arev-media-test-${Date.now()}`);
    const worker = new MockWorker();
    registerMediaRoutes(app, { worker, tempRoot });
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const base = `http://127.0.0.1:${address.port}`;

    const inspectionResponse = await fetch(`${base}/api/media/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-arev-client": "owner-a" },
      body: JSON.stringify({ url: "https://media.example.test/video.mp4?token=secret" }),
    });
    expect(inspectionResponse.status).toBe(200);
    const inspection = await inspectionResponse.json();
    expect(inspection.formats).toEqual([
      expect.objectContaining({ id: "f1", height: 720, ext: "mp4", mimeType: "video/mp4", hasAudio: true }),
    ]);
    expect(inspection.source).not.toContain("token");

    const foreignJob = await fetch(`${base}/api/media/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-arev-client": "owner-b" },
      body: JSON.stringify({ inspectionId: inspection.inspectionId, formatId: "f1" }),
    });
    expect(foreignJob.status).toBe(404);

    const ownJob = await fetch(`${base}/api/media/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-arev-client": "owner-a" },
      body: JSON.stringify({ inspectionId: inspection.inspectionId, formatId: "f1" }),
    });
    expect(ownJob.status).toBe(202);
    const job = await ownJob.json();
    expect(job.status).toBe("queued");
    expect(job.downloadPath).toBeUndefined();
  });

  it("requires the installation secret on every route", async () => {
    const app = express();
    app.use(express.json());
    const service = new MediaService({ worker: new MockWorker(), tempRoot: "/tmp/arev-media-test-auth" });
    registerMediaRoutes(app, { worker: new MockWorker(), tempRoot: "/tmp/arev-media-test-auth" });
    expect(service).toBeTruthy();
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/media/jobs/not-real`);
    expect(response.status).toBe(401);
  });

  it("maps protected source rejection to a friendly non-sensitive error", async () => {
    const app = express();
    app.use(express.json());
    const worker = new MockWorker();
    worker.inspectError = new MediaWorkerError("protected_content");
    registerMediaRoutes(app, { worker, tempRoot: "/tmp/arev-media-test-protected" });
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/media/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-arev-client": "owner-a" },
      body: JSON.stringify({ url: "https://media.example.test/protected" }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("DRM");
    expect(body.error).not.toContain("protected");
  });
});
