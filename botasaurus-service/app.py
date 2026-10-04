import os
from urllib.parse import urljoin, urlparse

from botasaurus.request import request, Request
from botasaurus.soupify import soupify
from fastapi import FastAPI, HTTPException


app = FastAPI(title="Nova Math Botasaurus Service", version="1.0.0")


def _csv_env(name: str):
    return [x.strip() for x in os.getenv(name, "").split(",") if x.strip()]


def _allowed_hosts():
    return {x.lower().lstrip(".") for x in _csv_env("BOTASAURUS_ALLOWED_HOSTS")}


def _sports_sources():
    return _csv_env("BOTASAURUS_SPORTS_SOURCE_URLS")


def _host_allowed(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    allowed = _allowed_hosts()
    if not allowed:
        return False
    host = parsed.hostname.lower()
    return any(host == item or host.endswith("." + item) for item in allowed)


def _clean_text(value, limit=160):
    return " ".join(str(value or "").split())[:limit]


@request(max_retry=2)
def scrape_visible_links(http: Request, data):
    url = data["url"]
    response = http.get(url)
    response.raise_for_status()
    soup = soupify(response)

    title = _clean_text(soup.title.get_text(" ", strip=True) if soup.title else "", 200)
    links = []

    for anchor in soup.find_all("a", href=True):
        href = urljoin(url, anchor.get("href", "")).strip()
        parsed = urlparse(href)
        if parsed.scheme not in {"http", "https"}:
            continue

        label = _clean_text(anchor.get_text(" ", strip=True) or anchor.get("title") or parsed.hostname or "Link", 140)
        img = anchor.find("img")
        logo = urljoin(url, img.get("src", "")).strip() if img and img.get("src") else ""

        links.append({
            "name": label,
            "url": href,
            "logo": logo,
        })

    return {
        "url": url,
        "title": title,
        "links": links[:500],
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "nova-botasaurus",
        "framework": "Botasaurus",
        "allowedHostsConfigured": bool(_allowed_hosts()),
        "sportsSourcesConfigured": len(_sports_sources()),
    }


@app.get("/sports/channels")
def sports_channels():
    sources = _sports_sources()
    if not sources:
        return {
            "channels": [],
            "source": "Botasaurus",
            "detail": "No BOTASAURUS_SPORTS_SOURCE_URLS configured.",
        }

    channels = []
    seen = set()
    errors = []

    for source_url in sources:
        if not _host_allowed(source_url):
            errors.append({"url": source_url, "error": "Host is not allow-listed"})
            continue

        try:
            result = scrape_visible_links({"url": source_url})
        except Exception as exc:
            errors.append({"url": source_url, "error": _clean_text(exc, 180)})
            continue

        for item in result.get("links", []):
            stream_url = item.get("url", "")
            # Only accept direct public HLS links that are visibly linked in the page.
            # This service does not inspect protected network traffic, bypass DRM, or
            # attempt to extract private/paywalled manifests.
            if ".m3u8" not in stream_url.lower():
                continue
            if stream_url in seen:
                continue
            seen.add(stream_url)
            channels.append({
                "name": item.get("name") or "Sports Stream",
                "url": stream_url,
                "logo": item.get("logo") or "",
                "group": "Botasaurus",
                "country": "",
                "language": "",
                "tvgId": "",
                "source": "botasaurus-public-page",
            })

    return {
        "channels": channels[:300],
        "source": "Botasaurus public-page discovery",
        "sourcesChecked": len(sources),
        "errors": errors[:20],
    }


@app.get("/scrape")
def scrape(url: str):
    if not _host_allowed(url):
        raise HTTPException(
            status_code=403,
            detail="Host is not in BOTASAURUS_ALLOWED_HOSTS.",
        )
    try:
        return scrape_visible_links({"url": url})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=_clean_text(exc, 180)) from exc
