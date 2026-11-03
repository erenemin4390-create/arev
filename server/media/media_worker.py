#!/usr/bin/env python3
"""AREV media worker.

The worker is intentionally line-oriented: one JSON request on stdin and JSON events on
stdout. It installs a DNS-pinning socket guard before yt-dlp is used. No cookies, proxies,
credentials, or browser state are accepted.
"""
from __future__ import annotations

import ipaddress
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

MAX_BYTES = 512 * 1024 * 1024
MAX_DURATION = 30 * 60
ALLOWED_PORTS = {80, 443}
ALLOWED_EXTS = {"mp4", "webm", "m4a", "mp3", "jpg", "jpeg", "png", "gif", "webp"}
ALLOWED_MIMES = {
    "video/mp4", "video/webm", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/mpeg",
    "audio/mp3", "audio/webm",
    "image/jpeg", "image/png", "image/gif", "image/webp",
}

class MediaError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def public_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return bool(ip.is_global and not ip.is_private and not ip.is_loopback and not ip.is_link_local
                and not ip.is_reserved and not ip.is_multicast and not ip.is_unspecified)


def validate_url(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise MediaError("invalid_url")
    try:
        parsed = urllib.parse.urlsplit(value.strip())
        port = parsed.port
    except (ValueError, UnicodeError):
        raise MediaError("invalid_url")
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise MediaError("invalid_url")
    if port is not None and port not in ALLOWED_PORTS:
        raise MediaError("invalid_url")
    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        raise MediaError("private_url")
    if not public_ip(host) and re.fullmatch(r"[0-9a-fA-F:.]+", host):
        raise MediaError("private_url")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, ""))


class NetworkGuard:
    """Pin every hostname to its first public DNS answer and reject private connections."""
    def __init__(self) -> None:
        self._original_getaddrinfo = socket.getaddrinfo
        self._original_connect = socket.socket.connect
        self._pinned: dict[str, tuple[str, ...]] = {}

    def resolve(self, host: str, port: int | str | None) -> tuple[str, ...]:
        host = host.rstrip(".").lower()
        if not host:
            raise MediaError("private_url")
        try:
            literal = ipaddress.ip_address(host)
            addresses = (str(literal),)
        except ValueError:
            rows = self._original_getaddrinfo(host, port or 0, type=socket.SOCK_STREAM)
            addresses = tuple(dict.fromkeys(str(row[4][0]).split("%", 1)[0] for row in rows))
        if not addresses or any(not public_ip(item) for item in addresses):
            raise MediaError("private_url")
        old = self._pinned.get(host)
        if old is not None and set(old) != set(addresses):
            raise MediaError("private_url")
        self._pinned.setdefault(host, addresses)
        return self._pinned[host]

    def install(self) -> None:
        policy = self
        original_getaddrinfo = self._original_getaddrinfo
        original_connect = self._original_connect

        def guarded_getaddrinfo(host: Any, port: Any, family: int = 0, type: int = 0,
                                proto: int = 0, flags: int = 0) -> list[tuple[Any, ...]]:
            if host is None or isinstance(host, bytes):
                return original_getaddrinfo(host, port, family, type, proto, flags)
            addresses = policy.resolve(str(host), port)
            result: list[tuple[Any, ...]] = []
            for address in addresses:
                try:
                    result.extend(original_getaddrinfo(address, port, family, type, proto, flags))
                except socket.gaierror:
                    continue
            if not result:
                raise socket.gaierror(socket.EAI_NONAME, "No public address")
            return result

        def guarded_connect(sock: socket.socket, address: Any) -> Any:
            if sock.family in (socket.AF_INET, socket.AF_INET6) and isinstance(address, tuple) and address:
                if not public_ip(str(address[0])):
                    raise OSError("blocked non-public media destination")
            return original_connect(sock, address)

        socket.getaddrinfo = guarded_getaddrinfo  # type: ignore[assignment]
        socket.socket.connect = guarded_connect  # type: ignore[assignment]


GUARD = NetworkGuard()
GUARD.install()


def opener() -> urllib.request.OpenerDirector:
    # Do not inherit HTTP(S)_PROXY from the host: a proxy would make the socket guard unable
    # to establish the true destination and could turn a safe URL into a proxy tunnel.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def safe_open(url: str, method: str = "GET", headers: dict[str, str] | None = None):
    url = validate_url(url)
    parsed = urllib.parse.urlsplit(url)
    GUARD.resolve(parsed.hostname or "", parsed.port or (443 if parsed.scheme == "https" else 80))
    request_headers = {
        "User-Agent": "AREV/1.0 (public media downloader)",
        "Accept": "*/*",
        **(headers or {}),
    }
    request = urllib.request.Request(url, method=method, headers=request_headers)
    try:
        response = opener().open(request, timeout=20)
    except urllib.error.HTTPError as exc:
        if method == "HEAD" and exc.code in (403, 405, 501):
            try:
                response = opener().open(
                    urllib.request.Request(url, method="GET", headers={**request_headers, "Range": "bytes=0-0"}),
                    timeout=20,
                )
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
                raise MediaError("media_not_found")
        else:
            raise MediaError("media_not_found")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise MediaError("media_not_found")
    final = validate_url(response.geturl())
    final_parsed = urllib.parse.urlsplit(final)
    GUARD.resolve(final_parsed.hostname or "", final_parsed.port or (443 if final_parsed.scheme == "https" else 80))
    if response.status < 200 or response.status >= 300:
        response.close()
        raise MediaError("media_not_found")
    return response, final


def content_type(response: Any) -> str:
    return (response.headers.get_content_type() or "").lower().strip()


def safe_download(url: str, output: Path, progress: bool = False) -> tuple[str, int]:
    response, final = safe_open(url, "GET")
    declared = response.headers.get("Content-Length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        response.close()
        raise MediaError("size_limit")
    written = 0
    try:
        with output.open("wb") as stream:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_BYTES:
                    raise MediaError("size_limit")
                stream.write(chunk)
                if progress:
                    emit({"event": "progress", "percent": None})
    finally:
        response.close()
    return final, written


def ffprobe(path: Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            check=False, capture_output=True, text=True, timeout=45,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise MediaError("unsupported_source")
    if result.returncode != 0:
        raise MediaError("unsupported_source")
    try:
        data = json.loads(result.stdout)
    except (TypeError, ValueError):
        raise MediaError("unsupported_source")
    streams = data.get("streams") or []
    if not streams:
        raise MediaError("unsupported_source")
    duration_value = (data.get("format") or {}).get("duration")
    try:
        duration = float(duration_value) if duration_value is not None else None
    except (ValueError, TypeError):
        duration = None
    if duration is not None and (duration < 0 or duration > MAX_DURATION):
        raise MediaError("duration_limit")
    return {"streams": streams, "format": data.get("format") or {}, "duration": duration}


def ext_for(mime: str, probe: dict[str, Any], url: str = "") -> str:
    mime = mime.lower().split(";", 1)[0]
    mapping = {
        "video/mp4": "mp4", "video/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
        "audio/m4a": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/webm": "webm",
        "audio/ogg": "webm", "audio/wav": "webm", "audio/x-wav": "webm",
        "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    }
    if mime in mapping:
        return mapping[mime]
    container = str((probe.get("format") or {}).get("format_name", "")).split(",", 1)[0]
    if container in ALLOWED_EXTS:
        return container
    suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower().lstrip(".")
    return suffix if suffix in ALLOWED_EXTS else ""


def kind_for(probe: dict[str, Any]) -> str:
    types = {str(stream.get("codec_type")) for stream in probe.get("streams", [])}
    if "video" in types:
        return "video"
    if "audio" in types:
        return "audio"
    return "image"


def direct_inspect(url: str, mime_hint: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="arev-inspect-") as temp:
        path = Path(temp) / "input"
        final, size = safe_download(url, path)
        probe = ffprobe(path)
        kind = kind_for(probe)
        mime = mime_hint if mime_hint in ALLOWED_MIMES else str((probe.get("format") or {}).get("format_name", ""))
        ext = ext_for(mime, probe, final)
        if ext not in ALLOWED_EXTS:
            raise MediaError("unsupported_source")
        streams = probe.get("streams", [])
        has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
        return {
            "kind": kind,
            "title": Path(urllib.parse.unquote(urllib.parse.urlsplit(final).path)).name or "AREV medya",
            "sourceUrl": final,
            "duration": probe.get("duration"),
            "formats": [{
            "key": "direct",
            "mode": "direct",
            "sourceUrl": final,
            "ext": ext,
                "mimeType": mime if mime in ALLOWED_MIMES else mimetypes.guess_type(f"x.{ext}")[0] or "application/octet-stream",
                "hasAudio": has_audio,
                "sizeBytes": size,
                "height": int(video.get("height")) if video.get("height") else None,
            }],
        }


def ytdlp_options() -> dict[str, Any]:
    return {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "cachedir": False,
        "cookiefile": None,
        "cookiesfrombrowser": None,
        "proxy": "",
        "socket_timeout": 20,
        "retries": 1,
        "fragment_retries": 1,
        "hls_prefer_native": True,
        "external_downloader": {},
        "logger": type("QuietLogger", (), {"debug": lambda *_: None, "warning": lambda *_: None, "error": lambda *_: None})(),
    }


def reject_protected(info: dict[str, Any]) -> None:
    live_status = str(info.get("live_status") or "").lower()
    if info.get("is_live") or live_status in {"is_live", "is_upcoming", "upcoming"}:
        raise MediaError("protected_content")
    if info.get("has_drm") or info.get("drm"):
        raise MediaError("protected_content")
    availability = str(info.get("availability") or "").lower()
    if availability in {"private", "needs_auth", "subscriber_only", "premium_only", "unlisted"}:
        raise MediaError("protected_content")


def safe_candidate_url(value: Any) -> bool:
    try:
        url = validate_url(value)
        parsed = urllib.parse.urlsplit(url)
        protocol = str(parsed.scheme).lower()
        return protocol in {"http", "https"}
    except MediaError:
        return False


def format_mime(ext: str, kind: str) -> str:
    return {
        "mp4": "video/mp4", "webm": "video/webm", "m4a": "audio/mp4", "mp3": "audio/mpeg",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp",
    }.get(ext, "video/mp4" if kind == "video" else "audio/mp4")


def build_ytdlp_formats(info: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    reject_protected(info)
    candidates = []
    for item in info.get("formats") or []:
        if not isinstance(item, dict) or not item.get("format_id"):
            continue
        if item.get("has_drm") or item.get("drm"):
            continue
        protocol = str(item.get("protocol") or "").lower()
        if protocol.startswith("m3u8") or "dash" in protocol or not safe_candidate_url(item.get("url")):
            continue
        ext = str(item.get("ext") or "").lower()
        if ext not in {"mp4", "webm", "m4a", "mp3"}:
            continue
        vcodec = str(item.get("vcodec") or "none")
        acodec = str(item.get("acodec") or "none")
        if vcodec == "none" and acodec == "none":
            continue
        candidates.append(item)
    videos = [item for item in candidates if str(item.get("vcodec") or "none") != "none"]
    audios = [item for item in candidates if str(item.get("acodec") or "none") != "none" and str(item.get("vcodec") or "none") == "none"]
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for item in sorted(videos, key=lambda x: (int(x.get("height") or 0), float(x.get("tbr") or 0)), reverse=True):
        ext = str(item.get("ext") or "").lower()
        if ext not in {"mp4", "webm"}:
            continue
        video_id = str(item["format_id"])
        has_audio = str(item.get("acodec") or "none") != "none"
        if has_audio:
            selector = video_id
            output_ext = ext
            audio_id = ""
        elif audios:
            matching = sorted(audios, key=lambda x: float(x.get("abr") or x.get("tbr") or 0), reverse=True)[0]
            audio_id = str(matching["format_id"])
            selector = f"{video_id}+{audio_id}"
            output_ext = ext
        else:
            continue
        key = (video_id, audio_id, output_ext)
        if key in seen:
            continue
        seen.add(key)
        size = item.get("filesize") or item.get("filesize_approx")
        if audio_id:
            audio_item = next((a for a in audios if str(a.get("format_id")) == audio_id), {})
            size = (int(size) if isinstance(size, (int, float)) else 0) + int(audio_item.get("filesize") or audio_item.get("filesize_approx") or 0)
        out.append({
            "key": f"yt-{len(out)}", "mode": "yt", "selector": selector, "ext": output_ext,
            "mimeType": format_mime(output_ext, "video"), "hasAudio": True,
            "sizeBytes": int(size) if isinstance(size, (int, float)) and size > 0 else None,
            "height": int(item["height"]) if item.get("height") else None,
        })
    for item in sorted(audios, key=lambda x: float(x.get("abr") or x.get("tbr") or 0), reverse=True):
        ext = str(item.get("ext") or "").lower()
        if ext not in {"m4a", "mp3", "webm"}:
            continue
        format_id = str(item["format_id"])
        size = item.get("filesize") or item.get("filesize_approx")
        out.append({
            "key": f"yt-{len(out)}", "mode": "yt", "selector": format_id, "ext": ext,
            "mimeType": format_mime(ext, "audio"), "hasAudio": True,
            "sizeBytes": int(size) if isinstance(size, (int, float)) and size > 0 else None,
        })
    if shutil.which("ffmpeg") and audios:
        best_audio = str(sorted(audios, key=lambda x: float(x.get("abr") or x.get("tbr") or 0), reverse=True)[0]["format_id"])
        out.append({
            "key": f"yt-{len(out)}", "mode": "yt", "selector": best_audio, "ext": "mp3",
            "mimeType": "audio/mpeg", "hasAudio": True, "postprocess": "mp3",
        })
    if not out:
        raise MediaError("media_not_found")
    kind = "video" if videos and any(item.get("hasAudio") for item in out) else "audio"
    return kind, out


def ytdlp_inspect(url: str) -> dict[str, Any]:
    try:
        import yt_dlp
    except ImportError:
        raise MediaError("worker_unavailable")
    try:
        with yt_dlp.YoutubeDL(ytdlp_options()) as downloader:
            info = downloader.extract_info(url, download=False)
    except Exception as exc:
        text = str(exc).lower()
        if any(word in text for word in ("login", "sign in", "cookie", "private", "drm", "live", "upcoming", "age-restricted")):
            raise MediaError("protected_content")
        raise MediaError("media_not_found")
    if not isinstance(info, dict):
        raise MediaError("media_not_found")
    reject_protected(info)
    if info.get("_type") == "playlist" or info.get("entries"):
        raise MediaError("unsupported_source")
    kind, formats = build_ytdlp_formats(info)
    duration = info.get("duration")
    if duration is not None and float(duration) > MAX_DURATION:
        raise MediaError("duration_limit")
    return {
        "kind": kind,
        "title": str(info.get("title") or "AREV medya")[:200],
        "sourceUrl": validate_url(url),
        "duration": float(duration) if duration is not None else None,
        "formats": formats,
    }


def inspect(url: str) -> dict[str, Any]:
    url = validate_url(url)
    response, final = safe_open(url, "HEAD")
    mime = content_type(response)
    response.close()
    if mime in ALLOWED_MIMES or mime in {"application/octet-stream", "binary/octet-stream"}:
        return direct_inspect(final, mime)
    return ytdlp_inspect(final)


def choose_output(output_dir: Path, expected_ext: str) -> Path:
    output_dir = output_dir.resolve()
    root = Path(os.environ.get("AREV_MEDIA_TEMP_ROOT", tempfile.gettempdir())).resolve()
    if root not in output_dir.parents and output_dir != root:
        raise MediaError("download_failed")
    output_dir.mkdir(parents=True, exist_ok=True)
    if expected_ext not in ALLOWED_EXTS:
        raise MediaError("unsupported_source")
    return output_dir / f"media.{expected_ext}"


def download_direct(spec: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    expected_ext = str(spec.get("ext") or "").lower()
    output = choose_output(output_dir, expected_ext)
    final, size = safe_download(str(spec.get("url") or ""), output, progress=False)
    probe = ffprobe(output)
    actual_ext = ext_for(str(spec.get("mimeType") or ""), probe, final)
    if actual_ext != expected_ext or size > MAX_BYTES:
        raise MediaError("unsupported_source")
    return {"fileName": output.name, "mimeType": format_mime(actual_ext, kind_for(probe)), "sizeBytes": size, "duration": probe.get("duration")}


def download_ytdlp(spec: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    try:
        import yt_dlp
    except ImportError:
        raise MediaError("worker_unavailable")
    page_url = validate_url(str(spec.get("pageUrl") or ""))
    expected_ext = str(spec.get("ext") or "").lower()
    output = choose_output(output_dir, expected_ext)
    selector = str(spec.get("selector") or "")
    if not selector or len(selector) > 256 or any(ch in selector for ch in "\r\n"):
        raise MediaError("invalid_request")

    def hook(data: dict[str, Any]) -> None:
        total_on_disk = sum(item.stat().st_size for item in output_dir.iterdir() if item.is_file()) if output_dir.exists() else 0
        if total_on_disk > MAX_BYTES:
            raise MediaError("size_limit")
        status = data.get("status")
        if status == "downloading":
            total = data.get("total_bytes") or data.get("total_bytes_estimate")
            done = data.get("downloaded_bytes")
            if total and done is not None:
                emit({"event": "progress", "percent": max(0.0, min(99.0, float(done) * 100 / float(total)))})
        elif status == "finished":
            emit({"event": "progress", "percent": 99.0})

    options = ytdlp_options()
    options.update({
        "skip_download": False,
        "format": selector,
        "outtmpl": str(output_dir / "media.%(ext)s"),
        "progress_hooks": [hook],
        "noplaylist": True,
        "merge_output_format": expected_ext if expected_ext in {"mp4", "webm"} else None,
    })
    if spec.get("postprocess") == "mp3":
        options["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            downloader.download([page_url])
    except MediaError:
        raise
    except Exception:
        raise MediaError("download_failed")
    files = [item for item in output_dir.iterdir() if item.is_file() and not item.name.endswith(".part") and item.suffix.lower().lstrip(".") in ALLOWED_EXTS]
    if len(files) != 1:
        raise MediaError("download_failed")
    actual = files[0]
    total_on_disk = sum(item.stat().st_size for item in output_dir.iterdir() if item.is_file())
    if total_on_disk > MAX_BYTES:
        raise MediaError("size_limit")
    size = actual.stat().st_size
    if size <= 0 or size > MAX_BYTES:
        raise MediaError("size_limit")
    probe = ffprobe(actual)
    actual_ext = actual.suffix.lower().lstrip(".")
    if actual_ext != expected_ext:
        raise MediaError("download_failed")
    return {"fileName": actual.name, "mimeType": format_mime(actual_ext, kind_for(probe)), "sizeBytes": size, "duration": probe.get("duration")}


def handle(request: dict[str, Any]) -> None:
    command = request.get("command")
    if command == "inspect":
        emit({"ok": True, "result": inspect(validate_url(request.get("url")))})
        return
    if command == "download":
        spec = request.get("spec") or {}
        output_dir = Path(str(request.get("outputDir") or ""))
        result = download_direct(spec, output_dir) if spec.get("mode") == "direct" else download_ytdlp(spec, output_dir)
        emit({"event": "progress", "percent": 100.0})
        emit({"ok": True, "result": result})
        return
    raise MediaError("invalid_request")


def main() -> int:
    try:
        line = sys.stdin.readline()
        if not line:
            raise MediaError("invalid_request")
        handle(json.loads(line))
        return 0
    except MediaError as exc:
        emit({"ok": False, "error": {"code": exc.code}})
        return 2
    except Exception:
        emit({"ok": False, "error": {"code": "worker_unavailable"}})
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
