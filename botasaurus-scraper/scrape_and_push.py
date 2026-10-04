import concurrent.futures
import hashlib
import hmac
import html
import json
import os
import re
import time
import uuid
from urllib.parse import urljoin, urlparse

import requests
from botasaurus.request import request, Request
from botasaurus.soupify import soupify


DEFAULT_INGEST_URL = "https://novamath-three.vercel.app/api/sports-api?action=botasaurus-ingest"
DEFAULT_SOURCES = [
    ("IPTV-org Sports", "https://iptv-org.github.io/iptv/categories/sports.m3u"),
    ("IPTV Cat Sports", "https://list.iptvcat.com/my_list/43a7920721455a884a8c7d23ee99c27f.m3u8"),
]

HLS_RE = re.compile(
    r"""https?://[^\s"'<>]+?\.m3u8(?:\?[^\s"'<>]*)?""",
    re.IGNORECASE,
)


def env_text(name, default=""):
    return str(os.getenv(name, default) or "").strip()


def env_int(name, default, minimum, maximum):
    try:
        value = int(env_text(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def env_bool(name, default=False):
    value = env_text(name, "1" if default else "0").lower()
    return value in {"1", "true", "yes", "on"}


def clean_text(value, limit=160):
    return " ".join(str(value or "").split())[:limit]


def parse_sources():
    raw = env_text("BOTASAURUS_SPORTS_SOURCE_URLS")
    if not raw:
        return [{"name": name, "url": url} for name, url in DEFAULT_SOURCES]

    rows = []
    for item in [x.strip() for x in re.split(r"[\n,]+", raw) if x.strip()]:
        name = ""
        url = item
        if "|" in item:
            left, right = item.split("|", 1)
            if right.strip().lower().startswith(("http://", "https://")):
                name, url = left.strip(), right.strip()

        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            continue

        rows.append({
            "name": clean_text(name or parsed.hostname, 120),
            "url": url[:1200],
        })
        if len(rows) >= 25:
            break
    return rows


def attr(line, key):
    match = re.search(r'%s="([^"]*)"' % re.escape(key), line, re.IGNORECASE)
    return match.group(1) if match else ""


def normalize_stream_url(value, base_url=""):
    value = html.unescape(str(value or "")).strip()
    value = value.replace("\\/", "/").replace("\\u0026", "&").replace("\\u003d", "=")
    value = value.strip(" \t\r\n\\\"'),;]")
    if base_url:
        value = urljoin(base_url, value)

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    if ".m3u8" not in value.lower():
        return ""
    return value[:1600]


def extinf_title(line):
    in_quote = False
    escaped = False
    for index, char in enumerate(line):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            in_quote = not in_quote
            continue
        if char == "," and not in_quote:
            return clean_text(line[index + 1:], 120)
    return "Sports Stream"


def parse_m3u(raw, source):
    rows = []
    meta = None

    for original in str(raw or "").splitlines():
        line = original.strip()
        if not line:
            continue

        if line.startswith("#EXTINF:"):
            meta = {
                "name": extinf_title(line),
                "tvgId": clean_text(attr(line, "tvg-id"), 100),
                "logo": clean_text(attr(line, "tvg-logo"), 1200),
                "group": clean_text(attr(line, "group-title") or source["name"], 100),
                "country": clean_text(attr(line, "tvg-country"), 30),
                "language": clean_text(attr(line, "tvg-language"), 30),
            }
            continue

        if meta and not line.startswith("#"):
            stream_url = normalize_stream_url(line, source["url"])
            if stream_url:
                rows.append({
                    **meta,
                    "url": stream_url,
                    "sourcePage": source["url"],
                    "source": "botasaurus-public-page",
                })
            meta = None

    return rows


def page_logo(soup, base_url):
    selectors = [
        ("meta", {"property": "og:image"}, "content"),
        ("meta", {"name": "twitter:image"}, "content"),
    ]
    for tag_name, attrs, value_attr in selectors:
        tag = soup.find(tag_name, attrs=attrs)
        if tag and tag.get(value_attr):
            value = urljoin(base_url, str(tag.get(value_attr)).strip())
            if value.startswith(("http://", "https://")):
                return value[:1200]
    return ""


def parse_html(response, source):
    raw_html = str(getattr(response, "text", "") or "")
    soup = soupify(response)
    title = clean_text(
        soup.title.get_text(" ", strip=True) if getattr(soup, "title", None) else source["name"],
        160,
    )
    logo = page_logo(soup, source["url"])
    rows = []
    seen = set()

    def add(raw_url, label=""):
        stream_url = normalize_stream_url(raw_url, source["url"])
        if not stream_url or stream_url in seen:
            return
        seen.add(stream_url)
        rows.append({
            "name": clean_text(label or title or source["name"] or "Sports Stream", 120),
            "url": stream_url,
            "logo": logo,
            "group": clean_text(source["name"], 100),
            "country": "",
            "language": "",
            "tvgId": "",
            "sourcePage": source["url"],
            "source": "botasaurus-public-page",
        })

    for tag in soup.find_all(True):
        label = (
            tag.get("data-title")
            or tag.get("title")
            or tag.get("aria-label")
            or clean_text(tag.get_text(" ", strip=True), 120)
        )
        for key in ("src", "href", "data-src", "data-url", "data-hls", "data-stream"):
            if tag.get(key):
                add(tag.get(key), label)

    normalized = raw_html.replace("\\/", "/").replace("\\u0026", "&").replace("\\u003d", "=")
    for stream_url in HLS_RE.findall(normalized):
        add(stream_url, title)

    return rows


@request(max_retry=2)
def scrape_source(http: Request, source):
    response = http.get(source["url"])
    status = int(getattr(response, "status_code", 200) or 200)
    if status >= 400:
        raise RuntimeError("source returned HTTP %s" % status)

    raw = str(getattr(response, "text", "") or "")
    if raw.lstrip().startswith("#EXTM3U"):
        channels = parse_m3u(raw, source)
    else:
        channels = parse_html(response, source)

    return {
        "source": source,
        "channels": channels,
    }


def validate_hls(channel):
    if not env_bool("BOTASAURUS_VALIDATE_STREAMS", True):
        return channel, ""

    timeout = env_int("BOTASAURUS_STREAM_TIMEOUT_SECONDS", 8, 3, 20)
    try:
        with requests.get(
            channel["url"],
            headers={
                "User-Agent": "Mozilla/5.0 (Nova Math Botasaurus validator)",
                "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
                "Range": "bytes=0-4095",
            },
            timeout=(5, timeout),
            allow_redirects=True,
            stream=True,
        ) as response:
            if response.status_code not in {200, 206}:
                return None, "HTTP %s" % response.status_code

            chunk = next(response.iter_content(chunk_size=4096), b"")
            sample = chunk.decode("utf-8", errors="ignore").lstrip()
            content_type = str(response.headers.get("content-type", "")).lower()

            if "#EXTM3U" in sample or "mpegurl" in content_type:
                return channel, ""
            return None, "response was not an HLS manifest"
    except Exception as exc:
        return None, clean_text(exc, 160)


def dedupe(channels):
    seen = set()
    output = []
    max_candidates = env_int("BOTASAURUS_MAX_CANDIDATES", 350, 1, 700)

    for channel in channels:
        url = normalize_stream_url(channel.get("url", ""))
        if not url or url in seen:
            continue
        seen.add(url)
        row = dict(channel)
        row["url"] = url
        output.append(row)
        if len(output) >= max_candidates:
            break

    return output


def push_snapshot(channels, sources, errors):
    secret = env_text("BOTASAURUS_INGEST_SECRET")
    if not secret:
        raise RuntimeError("BOTASAURUS_INGEST_SECRET is missing")

    ingest_url = env_text("NOVA_SPORTS_INGEST_URL", DEFAULT_INGEST_URL)
    if not ingest_url.startswith(("http://", "https://")):
        raise RuntimeError("NOVA_SPORTS_INGEST_URL is invalid")

    batch_id = uuid.uuid4().hex
    payload = {
        "version": 1,
        "batchId": batch_id,
        "generatedAt": int(time.time() * 1000),
        "ttlSeconds": env_int("BOTASAURUS_SNAPSHOT_TTL_SECONDS", 3600, 300, 7200),
        "channels": channels,
        "sources": sources,
        "errors": errors[:20],
    }

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
        timeout=(5, 25),
    )

    if response.status_code >= 400:
        raise RuntimeError(
            "Vercel ingest HTTP %s: %s"
            % (response.status_code, clean_text(response.text, 300))
        )

    result = response.json()
    if not result.get("ok"):
        raise RuntimeError("Vercel rejected scraper snapshot")

    return result


def main():
    sources = parse_sources()
    if not sources:
        raise RuntimeError("No valid Botasaurus source URLs are configured")

    all_channels = []
    source_stats = []
    errors = []

    for source in sources:
        try:
            result = scrape_source(source)
            rows = result.get("channels", [])
            all_channels.extend(rows)
            source_stats.append({
                "name": source["name"],
                "url": source["url"],
                "count": len(rows),
            })
            print("[source] %s: %s candidates" % (source["name"], len(rows)), flush=True)
        except Exception as exc:
            errors.append({"url": source["url"], "error": clean_text(exc, 180)})
            print("[source] %s failed: %s" % (source["name"], clean_text(exc, 180)), flush=True)

    candidates = dedupe(all_channels)
    if not candidates:
        raise RuntimeError("Botasaurus found no HLS candidates; current Vercel snapshot was left untouched")

    workers = env_int("BOTASAURUS_VALIDATION_WORKERS", 16, 1, 32)
    valid = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {executor.submit(validate_hls, row): row for row in candidates}
        for future in concurrent.futures.as_completed(future_map):
            row = future_map[future]
            try:
                good, reason = future.result()
            except Exception as exc:
                good, reason = None, clean_text(exc, 160)

            if good:
                valid.append(good)
            else:
                errors.append({"url": row["url"], "error": reason})

    max_streams = env_int("BOTASAURUS_MAX_STREAMS", 300, 1, 500)
    valid = valid[:max_streams]

    if not valid:
        raise RuntimeError("No fresh HLS streams passed validation; current Vercel snapshot was left untouched")

    result = push_snapshot(valid, source_stats, errors)
    print(
        json.dumps(
            {
                "ok": True,
                "candidates": len(candidates),
                "validated": len(valid),
                "batchId": result.get("batchId", ""),
                "expiresAt": result.get("expiresAt", 0),
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
