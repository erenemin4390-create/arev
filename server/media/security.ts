import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";

// Nashi WebDownloadEngine permits direct media transfers up to 20 GB and does
// not impose a 30-minute media-duration product limit.
export const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 365 * 24 * 60 * 60;
export const INSPECTION_TTL_MS = 30 * 60 * 1000;
export const JOB_TTL_MS = 6 * 60 * 60 * 1000;

const ALLOWED_PORTS = new Set([80, 443]);
const ALLOWED_EXTENSIONS = new Set(["mp4", "webm", "m4a", "mp3", "jpg", "jpeg", "png", "gif", "webp"]);
const ALLOWED_MEDIA_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/webm",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export class MediaSecurityError extends Error {
  constructor(
    public readonly code:
      | "invalid_url"
      | "private_url"
      | "client_required"
      | "invalid_request"
      | "unsupported_media",
    message: string,
  ) {
    super(message);
    this.name = "MediaSecurityError";
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
}

/**
 * Synchronous input validation. DNS validation is deliberately performed again in the
 * Python worker immediately before every network connection, so this helper never trusts
 * a hostname merely because it passed the syntax check.
 */
export function validateUrlSyntax(value: unknown): URL {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 4096) {
    throw new MediaSecurityError("invalid_url", "Geçerli bir bağlantı girin.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new MediaSecurityError("invalid_url", "Geçerli bir bağlantı girin.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MediaSecurityError("invalid_url", "Yalnızca http veya https bağlantıları desteklenir.");
  }
  if (url.username || url.password) {
    throw new MediaSecurityError("invalid_url", "Kullanıcı adı veya parola içeren bağlantılar desteklenmez.");
  }
  if (url.port && !ALLOWED_PORTS.has(Number(url.port))) {
    throw new MediaSecurityError("invalid_url", "Yalnızca standart http/https bağlantı noktaları desteklenir.");
  }

  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new MediaSecurityError("private_url", "Bu bağlantıya güvenli ağ kısıtlamaları nedeniyle erişilemiyor.");
  }
  if (isIP(hostname) !== 0 && !isPublicIp(hostname)) {
    throw new MediaSecurityError("private_url", "Bu bağlantıya güvenli ağ kısıtlamaları nedeniyle erişilemiyor.");
  }

  url.hash = "";
  return url;
}

/** Rejects loopback, private, link-local, reserved, multicast, unspecified and mapped private IPs. */
export function isPublicIp(value: string): boolean {
  const candidate = value.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(candidate);
  if (family === 0) return false;

  // IPv4-mapped IPv6 values must be evaluated as IPv4, not as a globally routable IPv6 value.
  if (family === 6 && candidate.startsWith("::ffff:")) {
    const mapped = candidate.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPublicIp(mapped);
  }

  // Avoid a dependency on a second IP library in the Node process. These ranges cover the
  // special-use space that must never be contacted by the media worker.
  if (family === 4) {
    const octets = candidate.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0) return false;
    if (a === 192 && b === 0 && octets[2] === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && octets[2] === 100) return false;
    if (a === 203 && b === 0 && octets[2] === 113) return false;
    if (a === 255 && b === 255 && octets[2] === 255 && octets[3] === 255) return false;
    return true;
  }

  const normalized = candidate.replace(/:/g, "").replace(/^0+/, "");
  if (!normalized) return false;
  // IPv6 loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7), multicast
  // (ff00::/8), documentation (2001:db8::/32), and IPv4-compatible special forms.
  if (candidate === "::" || candidate === "::1") return false;
  if (/^(?:fe[89ab]|fc|fd|ff)/.test(candidate)) return false;
  if (candidate.startsWith("2001:db8:")) return false;
  return true;
}

export function isAllowedMediaMime(mimeType: string): boolean {
  return ALLOWED_MEDIA_MIMES.has(mimeType.split(";", 1)[0]!.trim().toLowerCase());
}

export function isAllowedMediaExtension(ext: string): boolean {
  return ALLOWED_EXTENSIONS.has(ext.replace(/^\./, "").toLowerCase());
}

export function ownerKeyFromRequest(req: Request): string {
  const value = req.get("x-arev-client");
  if (!value || value.length > 256 || value.trim().length < 1) {
    throw new MediaSecurityError("client_required", "AREV istemci anahtarı gerekli.");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function requestAddress(req: Request): string {
  return req.socket?.remoteAddress || req.ip || "unknown";
}

/** Remove credentials, query tokens and fragments before a source is returned to the client. */
export function safeDisplaySource(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const path = url.pathname.length > 512 ? `${url.pathname.slice(0, 509)}...` : url.pathname;
    return `${url.origin}${path || "/"}`;
  } catch {
    return "";
  }
}

export function safeFilename(title: string, ext: string): string {
  const normalizedExt = ext.replace(/^\./, "").toLowerCase();
  const cleaned = title
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 140) || "arev-medya";
  const suffix = `.${normalizedExt}`;
  const stem = cleaned.toLowerCase().endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned;
  return `${stem || "arev-medya"}${suffix}`;
}

export function parseSingleRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) throw new RangeError("invalid range");
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) throw new RangeError("invalid range");

  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new RangeError("invalid range");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    throw new RangeError("invalid range");
  }
  return { start, end: Math.min(end, size - 1) };
}

export function isSafeRelativeChild(parent: string, candidate: string): boolean {
  const parentWithSlash = parent.endsWith("/") ? parent : `${parent}/`;
  return candidate.startsWith(parentWithSlash) && candidate !== parent;
}
