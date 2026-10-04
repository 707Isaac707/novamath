# Nova Math Botasaurus Service

This folder contains the Botasaurus sidecar used by Nova Math sports discovery.

It is intentionally excluded from the main Vercel deployment with `.vercelignore`.
That keeps the existing Nova Math Vercel Hobby deployment at the same 11 API functions.

## What it does

- Runs Botasaurus in a dedicated Python/Docker service.
- Exposes `GET /health`.
- Exposes `GET /scrape?url=...` for allow-listed public pages.
- Exposes `GET /sports/channels` for direct public HLS links that are visibly linked by configured public sports pages.
- Does not inspect protected network traffic, bypass DRM, or extract private/paywalled manifests.

## Required service environment variables

`BOTASAURUS_ALLOWED_HOSTS`
- Comma-separated hostnames the scraper is allowed to visit.
- Example: `example.org,stream.example.org`

`BOTASAURUS_SPORTS_SOURCE_URLS`
- Comma-separated public sports pages Botasaurus should inspect.
- Every source must belong to a hostname listed in `BOTASAURUS_ALLOWED_HOSTS`.

## Run with Docker

```bash
docker build -t nova-botasaurus .
docker run --rm -p 8000:8000 \
  -e BOTASAURUS_ALLOWED_HOSTS="example.org" \
  -e BOTASAURUS_SPORTS_SOURCE_URLS="https://example.org/sports" \
  nova-botasaurus
```

Then check:

```text
http://localhost:8000/health
http://localhost:8000/sports/channels
```

## Connect it to Nova Math

Host this Docker service on a container/VM provider and set this environment variable
on the existing Nova Math Vercel project:

`BOTASAURUS_API_URL=https://your-botasaurus-service.example`

The existing `/api/sports-api` endpoint will merge Botasaurus channels with the
current public IPTV sources, so no additional Vercel serverless function is required.
