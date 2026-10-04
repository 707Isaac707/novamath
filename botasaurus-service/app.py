import asyncio
import hashlib
import hmac
import html
import json
import os
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from urllib.parse import urljoin, urlparse

import requests
from botasaurus.request import request, Request
from botasaurus.soupify import soupify
from fastapi import FastAPI, Header, HTTPException


DEFAULT_INGEST_URL = "https://novamath-three.vercel.app/api/sports-api?action=botasaurus-ingest"
HLS_RE = re.compile(
    r"""https?:\\?/\\?/[^s"'<>]+?\.m3u8(?:\?[^s"'<>]*)?""",
    re.IGNORECASE,
)

RUN_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()
STATE = {
    "running": False,
    "lastStartedAt": 0,
    "lastFinishedAt": 0,
    "lastPushAt": 0,
    "lastBatchId": "",
    "lastCount": 0,
    "lastError": "",
    "cycles": 0,
}


def env_text(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(env_text(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def env_bool(name: str, default: bool = False) -> bool:
    value = env_text(name, "1" if default else "0").lower()
    return value in {"1", "true", "yes", "on"}


def split_env_list(name: str):
    raw = env_text(name)
    if not raw:
        return []
    return [item.strip() for item in re.split(r"[\n,]+", raw) if item.strip()]


def clean_text(value, limit=160):
    return " ".join(str(value or "").split())[:limit]


def allowed_hosts():
    return {item.lower().lstrip(".") for item in split_env_list("BOTASAURUS_ALLOWED_HOSTS")}


def host_allowed(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    allowed = allowed_hosts()
    return bool(allowed) and any(host == item or host.endswith("." + item) for item in allowed)


def source_rows():
    rows = []
    for item in split_env_list("BOTASAURUS_SPORTS_SOURCE_URLS"):
        if "|" in item and not item.lower().startswith(("http://", "https://")):
            name, url = item.split("|", 1)
        else:
            url = item
            name = urlparse(url).hostname or "Sports"
        rows.append({"name": clean_text(name, 120), "url": url.strip()})
    return rows


def normalize_stream_url(value: str, base_url: str = "") -> str:
    value = html.unescape(str(value or "")).strip()
    value = value.replace(r"\/", "/").replace(r"\u0026", "&").replace(r"\u003d", "=")
    value = value.strip(" \\t\\r\\n\\\"'),;]")
    if base_url:
        value = urljoin(base_url, value)
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    if ".m3u8" not in value.lower():
        return ""
    return value[:1600]


def page_logo(soup, base_url: str) -> str:
    for selector in [
        ("meta", {"property": "og:image"}, "content"),
        ("meta", {"name": "twitter:image"}, "content"),
    ]:
        tag = soup.find(selector[0], attrs=selector[1])
        if tag and tag.get(selector[2]):
            value = urljoin(base_url, str(tag.get(selector[2])).strip())
            if value.startswith(("http://", "https://")):
                return value[:1200]
    return ""


@request(max_retry=2)
def scrape_source_page(http: Request, data):
    source_url = data["url"]
    source_name = data["name"]

    response = http.get(source_url)
    status = int(getattr(response, "status_code", 200) or 200)
    if status >= 400:
        raise RuntimeError(f"source returned HTTP {status}")

    raw_html = str(getattr(response, "text", "") or "")
    soup = soupify(response)
    title = clean_text(
        soup.title.get_text(" ", strip=True) if getattr(soup, "title", None) else source_name,
        160,
    )
    logo = page_logo(soup, source_url)

    found = []
    seen = set()

    def add_candidate(raw_url, label=""):
        stream_url = normalize_stream_url(raw_url, source_url)
        if not stream_url or stream_url in seen:
            return
        seen.add(stream_url)
        found.append(
            {
                "name": clean_text(label or title or source_name or "Sports Stream", 120),
                "url": stream_url,
                "logo": logo,
                "group": clean_text(source_name or "Sports", 100),
                "country": "",
                "language": "",
                "tvgId": "",
                "sourcePage": source_url,
                "source": "botasaurus-public-page",
            }
        )

    for tag in soup.find_all(True):
        label = (
            tag.get("data-title")
            or tag.get("title")
            or tag.get("aria-label")
            or clean_text(tag.get_text(" ", strip=True), 120)
        )
        for attr_name in ("src", "href", "data-src", "data-url", "data-hls", "data-stream"):
            raw_value = tag.get(attr_name)
            if raw_value:
                add_candidate(raw_value, label)

    normalized_html = raw_html.replace(r"\/", "/").replace(r"\u0026", "&").replace(r"\u003d", "=")
    for match in HLS_RE.findall(normalized_html):
        add_candidate(match, title)

    return {
        "source": {"name": source_name, "url": source_url, "title": title},
        "channels": found,
    }


def validate_hls(channel):
    if not env_bool("BOTASAURUS_VALIDATE_STREAMS", True):
        return True, ""

    timeout = env_int("BOTASAURUS_STREAM_TIMEOUT_SECONDS", 8, 3, 20)
    try:
        with requests.get(
            channel["url"],
            headers={
                "User-Agent": "Mozilla/5.0 (Nova Math Botasaurus stream validator)",
                "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
                "Range": "bytes=0-4095",
            },
            timeout=(5, timeout),
            allow_redirects=True,
            stream=True,
        ) as response:
            if response.status_code not in {200, 206}:
                return False, f"HTTP {response.status_code}"

            chunk = next(response.iter_content(chunk_size=4096), b"")
            sample = chunk.decode("utf-8", errors="ignore").lstrip()
            content_type = str(response.headers.get("content-type", "")).lower()

            if "#EXTM3U" in sample or "mpegurl" in content_type:
                return True, ""
            return False, "response was not an HLS manifest"
    except Exception as exc:
        return False, clean_text(exc, 160)


def dedupe_channels(channels):
    max_streams = env_int("BOTASAURUS_MAX_STREAMS", 300, 1, 500)
    seen = set()
    output = []

    for row in channels:
        url = normalize_stream_url(row.get("url", ""))
        if not url or url in seen:
            continue
        seen.add(url)
        row = dict(row)
        row["url"] = url
        output.append(row)
        if len(output) >= max_streams:
            break

    return output


def signed_push(payload):
    secret = env_text("BOTASAURUS_INGEST_SECRET")
    ingest_url = env_text("NOVA_SPORTS_INGEST_URL", DEFAULT_INGEST_URL)
    if not secret:
        raise RuntimeError("BOTASAURUS_INGEST_SECRET is not configured")
    if not ingest_url.startswith(("http://", "https://")):
        raise RuntimeError("NOVA_SPORTS_INGEST_URL is invalid")

    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("utf-8") + b"." + body,
        hashlib.sha256,
    ).hexdigest()

    response = requests.post(
        ingest_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Nova-Timestamp": timestamp,
            "X-Nova-Signature": signature,
            "User-Agent": "NovaMath-Botasaurus/1.0",
        },
        timeout=(5, 20),
    )

    if response.status_code >= 400:
        raise RuntimeError(f"Vercel ingest HTTP {response.status_code}: {clean_text(response.text, 240)}")

    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError("Vercel ingest returned invalid JSON") from exc

    if not data.get("ok"):
        raise RuntimeError(f"Vercel ingest rejected batch: {clean_text(data, 240)}")
    return data


def run_scrape_cycle():
    if not RUN_LOCK.acquire(blocking=False):
        return {"ok": False, "skipped": True, "reason": "scrape already running"}

    started = int(time.time() * 1000)
    with STATE_LOCK:
        STATE["running"] = True
        STATE["lastStartedAt"] = started
        STATE["lastError"] = ""

    try:
        sources = source_rows()
        if not sources:
            raise RuntimeError("BOTASAURUS_SPORTS_SOURCE_URLS is empty")
        if not allowed_hosts():
            raise RuntimeError("BOTASAURUS_ALLOWED_HOSTS is empty")

        all_channels = []
        source_stats = []
        errors = []

        for source in sources:
            if not host_allowed(source["url"]):
                errors.append({"url": source["url"], "error": "source host is not allow-listed"})
                continue

            try:
                result = scrape_source_page(source)
                rows = result.get("channels", [])
                all_channels.extend(rows)
                source_stats.append(
                    {
                        "url": source["url"],
                        "name": source["name"],
                        "count": len(rows),
                    }
                )
            except Exception as exc:
                errors.append({"url": source["url"], "error": clean_text(exc, 180)})

        candidates = dedupe_channels(all_channels)
        valid = []

        for channel in candidates:
            ok, reason = validate_hls(channel)
            if ok:
                valid.append(channel)
            else:
                errors.append({"url": channel["url"], "error": reason})

        if not valid:
            raise RuntimeError("No validated public HLS streams were found; previous snapshot was left untouched")

        batch_id = uuid.uuid4().hex
        ttl_seconds = env_int("BOTASAURUS_SNAPSHOT_TTL_SECONDS", 900, 60, 1800)
        payload = {
            "version": 1,
            "batchId": batch_id,
            "generatedAt": int(time.time() * 1000),
            "ttlSeconds": ttl_seconds,
            "channels": valid,
            "sources": source_stats,
            "errors": errors[:20],
        }

        pushed = signed_push(payload)
        finished = int(time.time() * 1000)

        with STATE_LOCK:
            STATE["running"] = False
            STATE["lastFinishedAt"] = finished
            STATE["lastPushAt"] = finished
            STATE["lastBatchId"] = batch_id
            STATE["lastCount"] = len(valid)
            STATE["lastError"] = ""
            STATE["cycles"] += 1

        return {
            "ok": True,
            "count": len(valid),
            "batchId": batch_id,
            "expiresAt": pushed.get("expiresAt", 0),
            "errors": errors[:20],
        }

    except Exception as exc:
        finished = int(time.time() * 1000)
        with STATE_LOCK:
            STATE["running"] = False
            STATE["lastFinishedAt"] = finished
            STATE["lastError"] = clean_text(exc, 240)
            STATE["cycles"] += 1
        raise
    finally:
        RUN_LOCK.release()


async def scheduler_loop():
    await asyncio.sleep(2)
    while True:
        try:
            await asyncio.to_thread(run_scrape_cycle)
        except Exception as exc:
            print(f"[botasaurus] scrape cycle failed: {clean_text(exc, 240)}", flush=True)

        interval = env_int("BOTASAURUS_INTERVAL_SECONDS", 300, 60, 1800)
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(scheduler_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Nova Math Botasaurus Sports Scraper",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
def health():
    with STATE_LOCK:
        state = dict(STATE)

    return {
        "ok": not bool(state["lastError"]),
        "service": "nova-botasaurus-sports",
        "framework": "Botasaurus",
        "sourcesConfigured": len(source_rows()),
        "allowedHostsConfigured": len(allowed_hosts()),
        "ingestConfigured": bool(env_text("BOTASAURUS_INGEST_SECRET")),
        "ingestUrl": env_text("NOVA_SPORTS_INGEST_URL", DEFAULT_INGEST_URL),
        "intervalSeconds": env_int("BOTASAURUS_INTERVAL_SECONDS", 300, 60, 1800),
        "snapshotTtlSeconds": env_int("BOTASAURUS_SNAPSHOT_TTL_SECONDS", 900, 60, 1800),
        **state,
    }


@app.post("/run-now")
async def run_now(x_admin_secret: str | None = Header(default=None)):
    admin_secret = env_text("BOTASAURUS_ADMIN_SECRET")
    if not admin_secret:
        raise HTTPException(status_code=404, detail="Manual run endpoint is disabled")
    if not x_admin_secret or not hmac.compare_digest(x_admin_secret, admin_secret):
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        return await asyncio.to_thread(run_scrape_cycle)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=clean_text(exc, 240)) from exc
